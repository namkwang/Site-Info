"""Admin user management — list / approve / reject / change role / delete."""
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from typing import Optional

from supabase_client import db
from deps import require_admin
from services import credentials as creds
from services.fail_log import recent_failures

router = APIRouter()


@router.get("/api/admin/fail-logs")
def list_fail_logs(
    target: Optional[str] = Query(None, description="예: org.photo_url_persist"),
    limit: int = Query(100, ge=1, le=500),
    _admin: dict = Depends(require_admin),
):
    """삼켜진 실패 기록 조회 (pmis.app_fail_log). 사용자에게는 성공으로
    응답했지만 곁가지 작업이 실패한 건들이 쌓인다."""
    return recent_failures(limit=limit, target=target)


@router.post("/api/users/{user_id}/password")
def set_user_password(
    user_id: str,
    payload: dict = Body(default={}),
    admin: dict = Depends(require_admin),
):
    """관리자가 초기 비밀번호를 지정한다. 값을 주지 않으면 무작위로 만들어
    **응답에 한 번만** 돌려준다 — 해시만 저장하므로 다시 조회할 수 없다.

    지정한 비밀번호는 must_change 로 표시되어 사용자가 첫 로그인 후 바꾸게 된다.
    기존에 발급된 그 사용자의 토큰은 모두 무효가 된다."""
    r = db().from_("user_profile").select("id,email").eq("id", user_id).limit(1).execute()
    if not (r.data or []):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    raw = (payload or {}).get("password") or ""
    generated = False
    if not raw:
        raw = creds.generate_password()
        generated = True
    elif reason := creds.validate_strength(raw):
        raise HTTPException(status_code=400, detail=reason)

    creds.set_password(user_id, raw, actor_id=admin["id"], must_change=True)
    return {"ok": True, "must_change": True,
            # 무작위 생성한 경우에만 평문을 돌려준다. 관리자가 사용자에게
            # 전달해야 하고, 이후에는 어디에서도 다시 볼 수 없다.
            "password": raw if generated else None}


@router.get("/api/users")
def list_users(
    status: Optional[str] = Query(None, description="pending | approved | rejected"),
    _admin: dict = Depends(require_admin),
):
    q = db().from_("user_profile").select("*").order("requested_at", desc=True)
    if status:
        q = q.eq("status", status)
    r = q.execute()
    return r.data or []


@router.post("/api/users/{user_id}/approve")
def approve_user(
    user_id: str,
    payload: dict = Body(default={}),
    admin: dict = Depends(require_admin),
):
    """Approve a pending user. Optional body: {"role": "viewer" | "admin"}."""
    role = (payload or {}).get("role", "viewer")
    if role not in ("viewer", "admin"):
        raise HTTPException(status_code=400, detail="role은 'viewer' 또는 'admin'이어야 합니다")
    try:
        r = db().from_("user_profile").update({
            "status": "approved",
            "role": role,
            "approved_at": datetime.utcnow().isoformat(),
            "approved_by": admin["id"],
            "reject_reason": None,
        }).eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    row = (r.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return {"ok": True, "user": row}


@router.post("/api/users/{user_id}/reject")
def reject_user(
    user_id: str,
    payload: dict = Body(default={}),
    admin: dict = Depends(require_admin),
):
    """Reject a pending user with optional reason."""
    reason = (payload or {}).get("reason") or None
    try:
        r = db().from_("user_profile").update({
            "status": "rejected",
            "reject_reason": reason,
            "approved_by": admin["id"],
        }).eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    row = (r.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return {"ok": True, "user": row}


@router.post("/api/users/{user_id}/role")
def change_user_role(
    user_id: str,
    payload: dict = Body(...),
    _admin: dict = Depends(require_admin),
):
    """Change an approved user's role."""
    role = (payload or {}).get("role")
    if role not in ("viewer", "admin"):
        raise HTTPException(status_code=400, detail="role은 'viewer' 또는 'admin'이어야 합니다")
    try:
        r = db().from_("user_profile").update({"role": role}).eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    row = (r.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return {"ok": True, "user": row}


@router.delete("/api/users/{user_id}")
def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    """사용자 삭제. 계정이 우리 스키마에만 있으므로 프로필과 자격증명을 함께
    지운다(FK 가 없어 cascade 되지 않는다). 본인은 삭제할 수 없다.

    자격증명을 먼저 지운다 — 순서가 반대면 프로필이 없는 자격증명이 남는데,
    로그인은 프로필로 사용자를 찾으므로 그 흔적은 접근에 쓰이지 않는다."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="본인 계정은 삭제할 수 없습니다")
    try:
        db().from_("user_credential").delete().eq("user_id", user_id).execute()
        r = db().from_("user_profile").delete().eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"삭제 실패: {e}")
    if not (r.data or []):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return {"ok": True}
