"""Auth endpoints — /api/me and /api/auth/signup.

가입 처리가 여기 있는 이유: Supabase Auth(auth 스키마)는 계정(이메일·비밀번호)과
JWT 발급만 담당하고, 그 외 아무 일도 하지 않아야 한다. 프로필(pmis.user_profile)
생성은 auth.users 트리거가 아니라 이 라우터가 직접 한다 — 팀 공용 Supabase
프로젝트에서 다른 스키마/공유 객체를 건드리지 않기 위한 원칙이다.
(트리거 제거는 db/migrations/016 참조)
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from deps import get_current_user_raw
from supabase_client import db, supabase

router = APIRouter()


@router.get("/api/me")
def api_me(user: dict = Depends(get_current_user_raw)):
    """Current user + profile. Works for any authenticated token regardless of
    approval status, so the frontend can redirect pending/rejected users to
    the appropriate page."""
    p = user.get("profile") or {}
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user.get("role") or "user",
        "status": p.get("status"),
        "full_name": p.get("full_name"),
        "employee_number": p.get("employee_number"),
        "corporation_id": p.get("corporation_id"),
    }


class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1)
    employee_number: str = Field(min_length=1)
    corporation_id: int

    @field_validator("email")
    @classmethod
    def _email_shape(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("올바른 이메일 형식이 아닙니다")
        return v


@router.post("/api/auth/signup", status_code=201)
def signup(body: SignupRequest):
    """계정 생성(auth) + 프로필 생성(pmis)을 한 번에 처리하는 공개 엔드포인트.

    auth.users에는 이메일/비밀번호만 남긴다(user_metadata 없음). 프로필이
    없는 auth 계정은 이 앱에서 pending 취급되어 아무것도 못 하므로, 두 단계
    사이에서 실패해도 보안 문제는 없지만 — 재가입이 막히지 않도록 프로필
    insert 실패 시 방금 만든 auth 계정을 지워 원상복구한다."""
    try:
        created = supabase.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            # 내부 승인제(관리자 approve)가 게이트이므로 이메일 인증은 생략
            "email_confirm": True,
        })
    except Exception as e:
        msg = str(e)
        if "already" in msg.lower() or "registered" in msg.lower():
            raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다")
        raise HTTPException(status_code=502, detail="계정 생성에 실패했습니다. 잠시 후 다시 시도해주세요")

    user_id = created.user.id
    try:
        # upsert인 이유: 016 적용 전(트리거가 아직 있는 환경)에는 create_user
        # 시점에 트리거가 빈 프로필을 먼저 만들어 insert가 중복 키로 죽는다.
        # 방금 만든 계정이므로 덮어써도 잃을 데이터가 없다.
        db().from_("user_profile").upsert({
            "id": str(user_id),
            "email": body.email,
            "full_name": body.full_name.strip(),
            "employee_number": body.employee_number.strip(),
            "corporation_id": body.corporation_id,
            # role/status는 DB 기본값(user/pending)
        }).execute()
    except Exception:
        try:
            supabase.auth.admin.delete_user(user_id)
        except Exception:
            pass  # 프로필 없는 계정은 pending 취급이라 방치돼도 접근 불가
        raise HTTPException(status_code=502, detail="가입 처리에 실패했습니다. 잠시 후 다시 시도해주세요")

    return {"ok": True}
