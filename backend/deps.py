"""FastAPI dependencies — 인증·인가 3계층. 자격증명과 토큰 모두 우리 것이다.

로그인은 `POST /api/auth/login` 이 처리하고(services/credentials.py 가
bcrypt 해시를 검증), 세션 토큰은 services/tokens.py 가 발급한다. Supabase Auth
는 쓰지 않는다 — auth 스키마는 프로젝트당 하나뿐이라 팀 공용 프로젝트의 모든
서비스가 공유하고, 그러면 우리 사용자의 계정이 우리 통제를 벗어난다.

  get_current_user_raw — 토큰 유효, 프로필 로드 (pending/None 일 수 있음)
  get_current_user      — 위 + status == approved
  require_admin         — 위 + role == admin
"""
import time
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from services import credentials as credentials_service
from services import tokens
from supabase_client import db

_bearer = HTTPBearer(auto_error=False)


## In-memory profile cache. The dashboard fires three backend endpoints
##  in parallel (Promise.all on /sites + /statistics/summary +
##  /filter-options) — each used to issue its own user_profile query
##  through Depends(get_current_user), so the SAME user got their
##  profile looked up three times within a few-millisecond window.
##  A short-lived in-memory cache collapses that to a single DB hit.
##  TTL kept short (30 s) so role/status changes (admin approves a
##  pending user, etc.) propagate quickly without invalidation logic.
_PROFILE_CACHE: dict[str, tuple[float, Optional[dict]]] = {}
_PROFILE_CACHE_TTL = 30.0  # seconds


def _load_profile(user_id: str) -> Optional[dict]:
    now = time.time()
    cached = _PROFILE_CACHE.get(user_id)
    if cached is not None and (now - cached[0]) < _PROFILE_CACHE_TTL:
        return cached[1]
    try:
        r = (
            db()
            .from_("user_profile")
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception:
        # Don't cache failures — let the next request try again.
        return None
    rows = r.data or []
    profile = rows[0] if rows else None
    _PROFILE_CACHE[user_id] = (now, profile)
    return profile


def get_current_user_raw(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    """토큰을 검증하고 프로필을 붙인다. 프로필이 없거나 pending 일 수 있고,
    무엇을 할지는 호출자가 정한다 — /api/me 는 pending 사용자가 자기 상태를
    알 수 있어야 하므로 이 의존성을 쓴다."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")

    try:
        claims = tokens.decode(credentials.credentials)
    except tokens.TokenError as e:
        raise HTTPException(status_code=401, detail=e.detail)

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="세션이 유효하지 않습니다. 다시 로그인해주세요")

    # 비밀번호가 바뀐 뒤에 발급된 토큰만 받는다 — 비밀번호 변경이 곧 전체
    # 기기 로그아웃이 되게 하는 유일한 장치다(스테이트리스 토큰은 취소가 없다).
    changed = credentials_service.password_changed_at(user_id)
    if changed and tokens.issued_at(claims) < changed:
        raise HTTPException(status_code=401,
                            detail="비밀번호가 변경되었습니다. 다시 로그인해주세요")

    profile = _load_profile(user_id)
    return {
        "id": user_id,
        "email": (profile or {}).get("email") or claims.get("email"),
        "profile": profile,
        "role": (profile or {}).get("role", "user"),
        "status": (profile or {}).get("status"),
        "claims": claims,
    }


def get_current_user(user: dict = Depends(get_current_user_raw)) -> dict:
    """Approved users only. Use on endpoints that should be hidden from
    pending/rejected accounts."""
    profile = user.get("profile")
    if profile is None:
        raise HTTPException(status_code=403, detail="프로필이 존재하지 않습니다. 관리자에게 문의하세요")
    status_ = profile.get("status")
    if status_ == "pending":
        raise HTTPException(status_code=403, detail="가입 승인 대기 중입니다. 관리자 승인 후 이용하실 수 있습니다")
    if status_ == "rejected":
        raise HTTPException(status_code=403, detail="가입이 거부된 계정입니다")
    if status_ != "approved":
        raise HTTPException(status_code=403, detail="계정 상태가 유효하지 않습니다")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Admin only."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")
    return user
