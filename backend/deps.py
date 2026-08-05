"""FastAPI dependencies — three auth layers built on Supabase Auth.

Users authenticate via Supabase Auth (client-side), then send the JWT as
`Authorization: Bearer <token>`. We verify the JWT signature *locally*
against Supabase's JWKS (asymmetric ES256) — `PyJWKClient` fetches the
public keys once and caches them, so each request is signature-verified
without a Supabase Auth API round-trip. Profile (status/role) still
requires a single DB lookup, but that hits the same cached supabase
client connection.

  get_current_user_raw — JWT valid, profile loaded (may be pending/null)
  get_current_user      — above + status == approved
  require_admin         — above + role == admin
"""
import time
from typing import Optional

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from supabase_client import db, SUPABASE_URL

_bearer = HTTPBearer(auto_error=False)

# Supabase JWKS — public keys for verifying user JWTs. PyJWKClient caches
# the keys after the first fetch so signature verification is local. The
# cache is refreshed automatically when an unknown `kid` is encountered.
_jwks_client = jwt.PyJWKClient(
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
    cache_keys=True,
    max_cached_keys=8,
    lifespan=3600,  # refresh every 1h
)

# Supabase emits JWTs with this issuer. We validate it explicitly so a
# token signed by a different project (with a leaked key, etc.) is
# rejected even if its signature happens to verify.
_JWT_ISSUER = f"{SUPABASE_URL}/auth/v1"


def _verify_jwt_local(token: str) -> dict:
    """Verify a Supabase user JWT signature + expiry + issuer locally.
    Returns the decoded claims. Raises `HTTPException(401)` on any failure."""
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            issuer=_JWT_ISSUER,
            # Supabase audience is "authenticated" for logged-in users, but
            # some legacy projects don't set it. Skip the check — issuer +
            # signature + expiry are the security-relevant claims.
            options={"verify_aud": False},
        )
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="인증 토큰이 만료되었습니다")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="인증 토큰이 유효하지 않습니다")


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
    """Verify JWT and attach profile. Profile may be None or pending — the
    caller decides what to do. Used by /api/me so pending users can learn
    their own state."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    claims = _verify_jwt_local(credentials.credentials)
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="인증 토큰이 유효하지 않습니다")
    profile = _load_profile(user_id)
    return {
        "id": user_id,
        "email": claims.get("email"),
        "profile": profile,
        "role": (profile or {}).get("role", "user"),
        "status": (profile or {}).get("status"),
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
