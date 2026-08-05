"""Org chart, members, departments, headcount, photo upload.

Largest single domain — covers everything inside the per-site Org Chart
dialog. Read endpoints require an authenticated user; mutations require
admin.
"""
import json
from datetime import datetime

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
import traceback

from constants import BUCKET_ORG_PHOTOS
from supabase_client import db, supabase
from deps import get_current_user, require_admin
from services.org import seed_default_departments
from services.fail_log import log_failure

router = APIRouter()


# ── Org chart reads (org-chart, org-roles) moved to direct Supabase ─
# in `web/src/lib/api/org.ts` — RLS-protected via migrations 012/013.
# Mutations below still need backend-side validation + service-role.


@router.get("/api/sites/{site_id}/org-chart-bundle")
async def get_org_chart_bundle(site_id: int, _user: dict = Depends(get_current_user)):
    """All four org-chart slices in one round-trip.

    The dialog used to fan out: v_site_org_chart + departments +
    org_role + required-headcount in parallel from the browser. Even
    parallel, that's 4× JWT validation, 4× connection setup, and 4×
    auth-lock contention on the supabase-js getSession() — measurable
    on dialog-open. Folding them server-side cuts it to one request.

    Auto-seeds default departments on first access (mirrors
    /api/sites/{id}/departments behavior so callers don't need a
    separate priming call)."""
    org_resp = (
        db()
        .from_("v_site_org_chart")
        .select("*")
        .eq("site_id", site_id)
        .order("sort_order")
        .execute()
    )
    members = org_resp.data or []

    dept_resp = (
        db()
        .from_("site_department")
        .select("*")
        .eq("site_id", site_id)
        .order("sort_order")
        .execute()
    )
    departments = dept_resp.data or []
    if not departments:
        try:
            seed_default_departments(site_id)
            dept_resp = (
                db()
                .from_("site_department")
                .select("*")
                .eq("site_id", site_id)
                .order("sort_order")
                .execute()
            )
            departments = dept_resp.data or []
        except Exception as e:
            log_failure("org.default_department_seed", e, source_key=site_id)

    role_resp = (
        db()
        .from_("org_role")
        .select("*")
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )
    roles = role_resp.data or []

    rh_resp = (
        db()
        .from_("project_site")
        .select("required_headcount")
        .eq("id", site_id)
        .limit(1)
        .execute()
    )
    rh_row = (rh_resp.data or [{}])[0]
    rh_data = rh_row.get("required_headcount") or {}
    required_headcount = {
        "general": int(rh_data.get("general") or 0),
        "specialist": int(rh_data.get("specialist") or 0),
        "contract": int(rh_data.get("contract") or 0),
        "jv": int(rh_data.get("jv") or 0),
    }

    return {
        "members": members,
        "departments": departments,
        "roles": roles,
        "required_headcount": required_headcount,
    }


# ── Headcount ────────────────────────────────────────────────

@router.get("/api/sites/{site_id}/required-headcount")
async def get_required_headcount(site_id: int, _user: dict = Depends(get_current_user)):
    """사원 유형별 소요 인원 조회. 값 없으면 0으로 채워 반환."""
    response = (
        db()
        .from_("project_site")
        .select("required_headcount")
        .eq("id", site_id)
        .limit(1)
        .execute()
    )
    row = (response.data or [{}])[0]
    data = row.get("required_headcount") or {}
    return {
        "general": int(data.get("general") or 0),
        "specialist": int(data.get("specialist") or 0),
        "contract": int(data.get("contract") or 0),
        "jv": int(data.get("jv") or 0),
    }


@router.put("/api/sites/{site_id}/required-headcount")
async def update_required_headcount(site_id: int, payload: dict = Body(...), _admin: dict = Depends(require_admin)):
    """사원 유형별 소요 인원 저장."""
    data = {
        "general": max(0, int(payload.get("general") or 0)),
        "specialist": max(0, int(payload.get("specialist") or 0)),
        "contract": max(0, int(payload.get("contract") or 0)),
        "jv": max(0, int(payload.get("jv") or 0)),
    }
    db().from_("project_site").update({"required_headcount": data}).eq("id", site_id).execute()
    return data


# ── Departments ──────────────────────────────────────────────

@router.get("/api/sites/{site_id}/departments")
async def get_site_departments(site_id: int, _user: dict = Depends(get_current_user)):
    """Get departments for a site. Auto-seeds defaults on first access if empty."""
    response = (
        db()
        .from_("site_department")
        .select("*")
        .eq("site_id", site_id)
        .order("sort_order")
        .execute()
    )
    rows = response.data or []
    if not rows:
        try:
            seed_default_departments(site_id)
            response = (
                db()
                .from_("site_department")
                .select("*")
                .eq("site_id", site_id)
                .order("sort_order")
                .execute()
            )
            rows = response.data or []
        except Exception as e:
            log_failure("org.default_department_seed", e, source_key=site_id)
    return rows


@router.post("/api/sites/{site_id}/departments")
async def create_site_department(site_id: int, payload: dict = Body(...), admin: dict = Depends(require_admin)):
    """Create a new department for a site."""
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="팀 이름을 입력해주세요")
    # sort_order: 마지막 순서 + 10
    existing = (
        db()
        .from_("site_department")
        .select("sort_order")
        .eq("site_id", site_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
    )
    next_order = payload.get("sort_order")
    if next_order is None:
        next_order = (existing.data[0]["sort_order"] + 10) if existing.data else 10
    res = db().from_("site_department").insert({
        "site_id": site_id, "name": name, "sort_order": next_order,
        "created_by": admin["id"], "updated_by": admin["id"],
    }).execute()
    return res.data[0] if res.data else None


@router.put("/api/departments/{dept_id}")
async def update_site_department(dept_id: int, payload: dict = Body(...), admin: dict = Depends(require_admin)):
    """Rename or reorder a department."""
    patch: dict = {}
    if "name" in payload:
        n = (payload.get("name") or "").strip()
        if not n:
            raise HTTPException(status_code=400, detail="팀 이름을 입력해주세요")
        patch["name"] = n
    if "sort_order" in payload:
        patch["sort_order"] = int(payload["sort_order"])
    if not patch:
        raise HTTPException(status_code=400, detail="변경할 내용이 없습니다")
    patch["updated_by"] = admin["id"]
    res = db().from_("site_department").update(patch).eq("id", dept_id).execute()
    return res.data[0] if res.data else None


@router.delete("/api/departments/{dept_id}")
async def delete_site_department(dept_id: int, _admin: dict = Depends(require_admin)):
    """Delete department. Blocks if active members still reference it."""
    members = (
        db()
        .from_("site_org_member")
        .select("id", count="exact")
        .eq("department_id", dept_id)
        .eq("is_active", True)
        .execute()
    )
    count = members.count or 0
    if count > 0:
        raise HTTPException(status_code=400, detail=f"팀에 소속된 조직원 {count}명이 있습니다")
    db().from_("site_department").delete().eq("id", dept_id).execute()
    return {"ok": True}


# ── Org members ──────────────────────────────────────────────

@router.post("/api/sites/{site_id}/org-members")
async def create_org_member(site_id: int, member: dict, admin: dict = Depends(require_admin)):
    """Add a new org member."""
    member["site_id"] = site_id
    member["created_by"] = admin["id"]
    member["updated_by"] = admin["id"]
    response = db().from_("site_org_member").insert(member).execute()
    return response.data


@router.put("/api/org-members/{member_id}")
async def update_org_member(member_id: int, updates: dict, admin: dict = Depends(require_admin)):
    """Update an org member."""
    updates.pop("id", None)
    updates["updated_by"] = admin["id"]
    response = (
        db()
        .from_("site_org_member")
        .update(updates)
        .eq("id", member_id)
        .execute()
    )
    return response.data


@router.delete("/api/org-members/{member_id}")
async def delete_org_member(member_id: int, _admin: dict = Depends(require_admin)):
    """Soft-delete: set is_active=false."""
    db().from_("site_org_member").update({"is_active": False}).eq("id", member_id).execute()
    return {"ok": True}


@router.get("/api/org-members/{member_id}/profile")
async def get_org_member_profile(member_id: int, _user: dict = Depends(get_current_user)):
    """Get org member profile. Returns member data + parsed resume_data."""
    try:
        response = (
            db()
            .from_("v_site_org_chart")
            .select("*")
            .eq("id", member_id)
            .execute()
        )
        if not response.data:
            return JSONResponse(status_code=404, content={"error": "Member not found"})

        member = response.data[0]

        # Parse resume_data JSON
        resume = {}
        rd = member.get("resume_data")
        if rd:
            if isinstance(rd, str):
                try:
                    resume = json.loads(rd)
                except Exception:
                    pass
            elif isinstance(rd, dict):
                resume = rd

        # Get team members (same department or top-level)
        site_id = member.get("site_id")
        dept_id = member.get("department_id")
        peer_cols = "id,name,rank,role_name,phone,email,department_name"
        if dept_id:
            peers = (
                db()
                .from_("v_site_org_chart")
                .select(peer_cols)
                .eq("site_id", site_id).eq("department_id", dept_id)
                .order("sort_order").execute()
            )
        else:
            peers = (
                db()
                .from_("v_site_org_chart")
                .select(peer_cols)
                .eq("site_id", site_id).is_("parent_id", "null")
                .order("sort_order").execute()
            )

        return {
            "member": member,
            "resume": resume,
            "peers": peers.data or [],
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "trace": traceback.format_exc()},
        )


@router.put("/api/org-members/{member_id}/profile")
async def update_org_member_profile(member_id: int, body: dict, _admin: dict = Depends(require_admin)):
    """Update org member profile fields."""
    allowed = {
        "birth_date", "address", "phone_work", "photo_url",
        "job_category", "skills", "hobby", "entry_type",
        "task_detail", "resume_data",
        "name", "rank", "phone", "email", "specialty",
    }
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return {"ok": True}
    updates["updated_at"] = datetime.utcnow().isoformat()
    response = (
        db()
        .from_("site_org_member")
        .update(updates).eq("id", member_id).execute()
    )
    return response.data


# ── Photo upload ─────────────────────────────────────────────

@router.post("/api/upload-org-photo")
async def upload_org_photo(file: UploadFile = File(...), member_id: str = Form(...), _admin: dict = Depends(require_admin)):
    """Upload or replace an org member photo to Supabase Storage.

    Also persists the URL to `site_org_member.photo_url` so the chart can
    skip the per-card image fetch for members who never had a photo (no
    column = no <img src>, no 404). Cache-busting `?t=` is appended so
    the chart re-fetches after a replace."""
    content = await file.read()
    file_name = f"member_{member_id}.jpg"
    supabase.storage.from_(BUCKET_ORG_PHOTOS).upload(
        file_name, content,
        file_options={"content-type": file.content_type or "image/jpeg", "upsert": "true"},
    )
    public_url = supabase.storage.from_(BUCKET_ORG_PHOTOS).get_public_url(file_name)
    versioned_url = f"{public_url}?t={int(datetime.utcnow().timestamp())}"
    try:
        db().from_("site_org_member").update(
            {"photo_url": versioned_url}
        ).eq("id", int(member_id)).execute()
    except Exception as e:
        # 업로드는 됐으나 URL 이 DB에 안 남은 상태 — 조직도에서 사진이 안 보인다.
        # 재업로드하면 복구되므로 요청은 성공으로 두고 원인만 남긴다.
        log_failure("org.photo_url_persist", e,
                    source_key=member_id, raw_data={"url": versioned_url})
    return {"ok": True, "url": versioned_url}
