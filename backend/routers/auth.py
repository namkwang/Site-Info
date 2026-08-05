"""인증 엔드포인트 — 로그인·세션 갱신·비밀번호 변경·가입, 그리고 /api/me.

사용자 관리와 **자격증명 검증 모두 우리 스키마가 담당한다.** Supabase Auth 는
쓰지 않는다:
  - 사용자 레코드·권한·승인상태 → site_info.user_profile
  - 비밀번호 해시 → site_info.user_credential (019)
  - 세션 토큰 → 우리가 발급 (services/tokens.py)

auth 스키마를 쓰지 않는 이유: Supabase 의 auth 는 프로젝트당 하나뿐이라 팀
공용 프로젝트의 모든 서비스가 공유한다. 그러면 우리 사용자의 계정과 비밀번호가
우리 통제를 벗어난다(실제로 22명 중 4명이 그랬다).
"""
import os
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from deps import get_current_user, get_current_user_raw
from services import credentials as creds
from services import tokens
from services.fail_log import log_failure
from services.session_cookie import clear_session, set_session
from supabase_client import db

router = APIRouter()

EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def _normalize_email(v: str) -> str:
    v = (v or "").strip().lower()
    if not EMAIL_RE.fullmatch(v):
        raise ValueError("올바른 이메일 형식이 아닙니다")
    return v


def _find_profile(email: str) -> dict | None:
    r = (db().from_("user_profile")
         .select("id,email,full_name,role,status")
         .eq("email", email).limit(1).execute())
    return (r.data or [None])[0]


# ── /api/me ─────────────────────────────────────────────────

@router.get("/api/me")
def api_me(user: dict = Depends(get_current_user_raw)):
    """현재 사용자 + 프로필. 승인 상태와 무관하게 동작해서, 프론트가
    pending/rejected 사용자를 알맞은 화면으로 보낼 수 있게 한다."""
    p = user.get("profile") or {}
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user.get("role") or "viewer",
        "status": p.get("status"),
        "full_name": p.get("full_name"),
        "employee_number": p.get("employee_number"),
        "corporation_id": p.get("corporation_id"),
        "must_change_password": creds.must_change_password(user["id"]),
    }


# ── 로그인 ───────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _normalize_email(v)


@router.post("/api/auth/login")
def login(body: LoginRequest, request: Request, response: Response):
    """이메일·비밀번호로 세션 토큰을 발급한다.

    승인 대기(pending) 사용자도 토큰은 받는다 — 프론트가 /pending 화면을
    보여주려면 자기 상태를 알아야 하고, 실제 데이터 접근은 get_current_user 가
    막는다."""
    profile = _find_profile(body.email)
    try:
        creds.verify_password(profile["id"] if profile else None, body.password)
    except creds.AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    token, expires_in = tokens.issue(profile["id"], profile["email"],
                                     profile.get("role") or "viewer",
                                     profile.get("status") or "pending")
    # 토큰은 HttpOnly 쿠키로 내려간다 — 브라우저 JS 가 만질 수 없고 SSR 이
    # 읽을 수 있다. 응답 본문에도 담아 두는 것은 서버 간 호출·테스트용이다.
    set_session(response, request, token, expires_in)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "must_change_password": creds.must_change_password(profile["id"]),
        "user": {
            "id": profile["id"],
            "email": profile["email"],
            "full_name": profile.get("full_name"),
            "role": profile.get("role") or "viewer",
            "status": profile.get("status"),
        },
    }


@router.post("/api/auth/refresh")
def refresh(request: Request, response: Response,
            user: dict = Depends(get_current_user_raw)):
    """유효한 토큰을 새 토큰으로 바꿔준다. 최초 로그인으로부터 절대 수명이
    지나면 거부한다 — 새어나간 토큰이 영구 통행증이 되지 않게.

    토큰의 role/status 는 발급 시점 값이라 관리자가 승인·권한을 바꿔도 바로
    반영되지 않는다. 갱신할 때 DB 의 현재 프로필로 다시 채워서, 승인 직후
    /pending 화면이 이 엔드포인트만 부르면 통과되게 한다."""
    claims = user["claims"]
    if not tokens.can_refresh(claims):
        raise HTTPException(status_code=401, detail="세션 기간이 만료되었습니다. 다시 로그인해주세요")
    p = user.get("profile") or {}
    token, expires_in = tokens.issue(
        user["id"], user["email"], p.get("role") or "viewer", p.get("status") or "pending",
        auth_started_at=tokens.auth_started(claims),
    )
    set_session(response, request, token, expires_in)
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in,
            "status": p.get("status"), "role": p.get("role")}


# ── 비밀번호 변경 ─────────────────────────────────────────────

class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=creds.MIN_LENGTH)


@router.post("/api/auth/password")
def change_password(body: PasswordChange, request: Request, response: Response,
                    user: dict = Depends(get_current_user_raw)):
    """본인 비밀번호 변경. 성공하면 기존 토큰이 전부 무효가 되므로(다른 기기
    로그아웃) 새 토큰을 함께 돌려준다."""
    try:
        creds.verify_password(user["id"], body.current_password)
    except creds.AuthError:
        # 잠금 정책은 로그인과 공유한다. 여기서는 이유를 구분해 알려도 안전하다.
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="새 비밀번호가 기존과 같습니다")
    if reason := creds.validate_strength(body.new_password):
        raise HTTPException(status_code=400, detail=reason)

    creds.set_password(user["id"], body.new_password, actor_id=user["id"])
    p = user.get("profile") or {}
    token, expires_in = tokens.issue(user["id"], user["email"],
                                     p.get("role") or "viewer", p.get("status") or "pending")
    set_session(response, request, token, expires_in)
    return {"ok": True, "access_token": token, "token_type": "bearer", "expires_in": expires_in}


# ── 가입 ─────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=creds.MIN_LENGTH)
    full_name: str = Field(min_length=1)
    employee_number: str = Field(min_length=1)
    corporation_id: int

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _normalize_email(v)


@router.post("/api/auth/signup", status_code=201)
def signup(body: SignupRequest):
    """가입 신청. 기본적으로 **닫혀 있다.**

    사용자 관리는 그룹 포털이 담당한다 — 포털이 부여한 권한으로만 계정이 생기고
    (SSO 최초 로그인 시 자동 생성), 여기로 직접 가입할 수 있으면 그 통제가
    무의미해진다(포털을 거치지 않은 계정이 생긴다).

    되살릴 필요가 생기면 SELF_SIGNUP_ENABLED=1 로 켠다. 엔드포인트를 지우지 않고
    막아 둔 이유는, 지웠을 때 프론트가 404 를 받아 원인을 알기 어려워지기
    때문이다 — 지금은 이유가 담긴 403 이 돌아간다."""
    if os.environ.get("SELF_SIGNUP_ENABLED", "").strip() not in ("1", "true", "True"):
        raise HTTPException(
            status_code=403,
            detail="직접 가입은 사용하지 않습니다. 그룹 포털에서 로그인해주세요.",
        )
    if reason := creds.validate_strength(body.password):
        raise HTTPException(status_code=400, detail=reason)
    if _find_profile(body.email):
        raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다")

    ins = db().from_("user_profile").insert({
        "email": body.email,
        "full_name": body.full_name.strip(),
        "employee_number": body.employee_number.strip(),
        "corporation_id": body.corporation_id,
        # role/status 는 DB 기본값(viewer/pending)
    }).execute()
    row = (ins.data or [None])[0]
    if not row:
        raise HTTPException(status_code=502, detail="가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요")

    try:
        creds.set_password(row["id"], body.password)
    except Exception as e:
        # 비밀번호 없는 프로필은 로그인이 불가능해 방치되면 이메일만 선점된다.
        # 프로필을 되돌려 재시도할 수 있게 한다.
        try:
            db().from_("user_profile").delete().eq("id", row["id"]).execute()
        except Exception:
            log_failure("auth.signup_rollback", e, source_key=row["id"])
        raise HTTPException(status_code=502, detail="가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요")

    return {"ok": True}


@router.post("/api/auth/logout")
def logout(request: Request, response: Response):
    """쿠키를 지운다. 스테이트리스 토큰이라 서버에 남는 세션은 없다 —
    같은 토큰을 다른 곳에 복사해 뒀다면 만료까지는 유효하다. 그 창을 없애려면
    비밀번호를 변경해야 한다(모든 토큰 무효)."""
    clear_session(response, request)
    return {"ok": True}
