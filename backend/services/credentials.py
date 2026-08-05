"""비밀번호 저장·검증 (site_info.user_credential).

인증을 우리가 담당하기로 했으므로 사고가 잘 나는 지점을 처음부터 막는다.

  - 해시는 bcrypt. Supabase 가 쓰던 방식과 같아($2a$/$2b$) 기존 해시를 그대로
    넣어도 검증된다 — 사용자가 같은 비밀번호를 계속 쓸 수 있다.
  - **계정 단위 시도 제한.** 없으면 비밀번호 대입이 무제한이다.
  - **존재하지 않는 계정도 같은 시간을 쓴다.** 응답 시간 차이로 어떤 이메일이
    가입돼 있는지 알아내는 것(사용자 열거)을 막는다.
  - 해시는 절대 라우터 바깥으로 반환하지 않는다.
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt

from supabase_client import db

# 잠금 정책. 내부 업무용 도구라 사용자를 오래 막는 것보다 대입을 느리게 만드는
# 쪽이 낫다 — 5회 실패 시 15분.
MAX_ATTEMPTS = 5
LOCK_MINUTES = 15

# 존재하지 않는 계정에 대해서도 bcrypt 검증 비용을 쓰기 위한 더미 해시.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt()).decode()

MIN_LENGTH = 8


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode()


def validate_strength(raw: str) -> Optional[str]:
    """받아들일 수 없는 비밀번호면 사용자에게 보여줄 이유를 돌려준다."""
    if len(raw) < MIN_LENGTH:
        return f"비밀번호는 {MIN_LENGTH}자 이상이어야 합니다"
    if raw.isdigit() or raw.isalpha():
        return "비밀번호에 영문과 숫자를 함께 사용해주세요"
    return None


def generate_password(length: int = 14) -> str:
    """관리자가 초기 비밀번호를 지정할 때 쓸 무작위 값. 혼동되는 문자는 뺀다."""
    alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if not validate_strength(pw):
            return pw


def set_password(user_id: str, raw: str, *, actor_id: Optional[str] = None,
                 must_change: bool = False) -> None:
    """비밀번호를 저장한다. 기존에 발급된 토큰은 모두 무효가 된다
    (password_changed_at 이 갱신되고 tokens.py 가 그 시각을 검사한다)."""
    now = _now().isoformat()
    db().from_("user_credential").upsert({
        "user_id": user_id,
        "password_hash": hash_password(raw),
        "failed_attempts": 0,
        "locked_until": None,
        "must_change": must_change,
        "password_changed_at": now,
        "updated_by": actor_id,
        "created_by": actor_id,
    }).execute()


def set_password_hash(user_id: str, password_hash: str, *,
                      actor_id: Optional[str] = None) -> None:
    """이미 계산된 bcrypt 해시를 그대로 넣는다 (기존 계정 이관용)."""
    db().from_("user_credential").upsert({
        "user_id": user_id,
        "password_hash": password_hash,
        "failed_attempts": 0,
        "locked_until": None,
        "must_change": False,
        "password_changed_at": _now().isoformat(),
        "created_by": actor_id,
        "updated_by": actor_id,
    }).execute()


def has_credential(user_id: str) -> bool:
    r = db().from_("user_credential").select("user_id").eq("user_id", user_id).limit(1).execute()
    return bool(r.data)


class AuthError(Exception):
    """로그인 실패. `detail` 은 사용자에게 그대로 보여줄 문구다.

    실패 이유를 세분화해서 알려주지 않는다 — "이메일이 없다"와 "비밀번호가
    틀렸다"를 구분해 주면 가입 여부를 알아내는 데 쓰인다. 잠금만 예외적으로
    알린다(사용자가 기다려야 하는 이유를 알아야 한다)."""

    def __init__(self, detail: str, *, status_code: int = 401):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def verify_password(user_id: Optional[str], raw: str) -> None:
    """비밀번호를 검증한다. 실패하면 AuthError 를 올린다.

    user_id 가 None(=그런 이메일이 없음)이어도 같은 비용을 쓰고 같은 메시지를
    돌려준다."""
    if user_id is None:
        bcrypt.checkpw(raw.encode("utf-8"), _DUMMY_HASH.encode())
        raise AuthError("이메일 또는 비밀번호가 올바르지 않습니다")

    r = (db().from_("user_credential")
         .select("password_hash,failed_attempts,locked_until")
         .eq("user_id", user_id).limit(1).execute())
    row = (r.data or [None])[0]
    if row is None:
        # 프로필은 있는데 비밀번호가 설정되지 않은 계정 — 관리자가 지정해야 한다.
        bcrypt.checkpw(raw.encode("utf-8"), _DUMMY_HASH.encode())
        raise AuthError("비밀번호가 설정되지 않은 계정입니다. 관리자에게 문의하세요")

    locked = row.get("locked_until")
    if locked and datetime.fromisoformat(locked) > _now():
        left = int((datetime.fromisoformat(locked) - _now()).total_seconds() // 60) + 1
        raise AuthError(f"로그인 시도가 많아 잠겼습니다. {left}분 후 다시 시도해주세요",
                        status_code=429)

    if bcrypt.checkpw(raw.encode("utf-8"), row["password_hash"].encode()):
        if row.get("failed_attempts"):
            db().from_("user_credential").update(
                {"failed_attempts": 0, "locked_until": None}
            ).eq("user_id", user_id).execute()
        return

    attempts = int(row.get("failed_attempts") or 0) + 1
    patch: dict = {"failed_attempts": attempts}
    if attempts >= MAX_ATTEMPTS:
        patch["locked_until"] = (_now() + timedelta(minutes=LOCK_MINUTES)).isoformat()
        patch["failed_attempts"] = 0
    db().from_("user_credential").update(patch).eq("user_id", user_id).execute()

    if "locked_until" in patch:
        raise AuthError(f"로그인 시도가 많아 {LOCK_MINUTES}분간 잠겼습니다", status_code=429)
    raise AuthError("이메일 또는 비밀번호가 올바르지 않습니다")


def password_changed_at(user_id: str) -> Optional[datetime]:
    """토큰 무효화 판단용 — 이 시각 이전에 발급된 토큰은 받지 않는다."""
    r = (db().from_("user_credential").select("password_changed_at")
         .eq("user_id", user_id).limit(1).execute())
    row = (r.data or [None])[0]
    if not row or not row.get("password_changed_at"):
        return None
    return datetime.fromisoformat(row["password_changed_at"])


def must_change_password(user_id: str) -> bool:
    r = (db().from_("user_credential").select("must_change")
         .eq("user_id", user_id).limit(1).execute())
    row = (r.data or [None])[0]
    return bool(row and row.get("must_change"))
