"""우리가 발급하는 세션 토큰.

Supabase Auth 를 쓰지 않으므로 토큰도 우리가 만든다. HS256 대칭키로 서명하며
키는 `APP_JWT_SECRET`(env). 백엔드만 검증하므로 대칭키로 충분하다.

Supabase 가 대신 해주던 것 중 우리가 반드시 챙겨야 하는 두 가지:

  1) **무효화** — 스테이트리스 토큰은 그 자체로는 취소할 수 없다. 비밀번호를
     바꾸면 그 시각(`password_changed_at`) 이전에 발급된 토큰을 거부해서
     "비밀번호 변경 = 모든 기기에서 로그아웃"이 되게 한다.
  2) **절대 수명** — 토큰을 계속 갱신할 수 있게 하면 한 번 새어나간 토큰이
     영구 통행증이 된다. 최초 로그인 시각(`ain`)을 담아 그 시점부터
     ABSOLUTE_HOURS 가 지나면 갱신을 거부하고 재로그인을 요구한다.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

ALGORITHM = "HS256"
ISSUER = "site-info"

# 접근 토큰 수명. 업무 중 갑자기 튕기지 않을 만큼 길고, 새어나갔을 때
# 노출 창이 너무 넓지 않을 만큼 짧게.
TTL_HOURS = 8
# 갱신을 허용하는 최대 기간 (최초 로그인 기준). 이후에는 재로그인.
ABSOLUTE_HOURS = 24 * 7


def _secret() -> str:
    s = os.environ.get("APP_JWT_SECRET", "")
    if len(s) < 32:
        # 짧은 키는 서명을 무의미하게 만든다. 조용히 넘어가지 않는다.
        raise RuntimeError(
            "APP_JWT_SECRET 이 없거나 너무 짧습니다(32자 이상 필요). "
            "backend/.env 에 설정하세요 — `python -c \"import secrets;"
            "print(secrets.token_urlsafe(48))\"`"
        )
    return s


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue(user_id: str, email: str, role: str,
          *, auth_started_at: Optional[datetime] = None) -> tuple[str, int]:
    """토큰과 만료까지의 초를 돌려준다. `auth_started_at` 은 갱신 시 원래 로그인
    시각을 이어받기 위한 값이다(절대 수명 계산용)."""
    now = _now()
    started = auth_started_at or now
    exp = now + timedelta(hours=TTL_HOURS)
    payload = {
        "iss": ISSUER,
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "ain": int(started.timestamp()),   # authentication instant
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM), int(TTL_HOURS * 3600)


class TokenError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def decode(token: str) -> dict:
    """서명·발급자·만료를 검증하고 claims 를 돌려준다.

    leeway 를 두는 이유는 deps.py 와 같다 — 서버 시계가 몇 초 어긋나도
    방금 발급한 토큰이 거부되지 않게 한다."""
    try:
        return jwt.decode(token, _secret(), algorithms=[ALGORITHM],
                          issuer=ISSUER, leeway=30,
                          options={"verify_iat": False})
    except jwt.ExpiredSignatureError:
        raise TokenError("세션이 만료되었습니다. 다시 로그인해주세요")
    except jwt.InvalidTokenError:
        raise TokenError("세션이 유효하지 않습니다. 다시 로그인해주세요")


def issued_at(claims: dict) -> datetime:
    return datetime.fromtimestamp(claims["iat"], tz=timezone.utc)


def can_refresh(claims: dict) -> bool:
    """절대 수명 안에 있는가."""
    started = datetime.fromtimestamp(claims.get("ain", claims["iat"]), tz=timezone.utc)
    return _now() - started < timedelta(hours=ABSOLUTE_HOURS)


def auth_started(claims: dict) -> datetime:
    return datetime.fromtimestamp(claims.get("ain", claims["iat"]), tz=timezone.utc)
