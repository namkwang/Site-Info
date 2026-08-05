"""관리주체(법인 산하 팀/부서) CRUD + 사이트 할당.

- 관리주체는 법인에 속한다 (corporation_id FK, ON DELETE CASCADE).
- 한 현장은 한 관리주체만 가질 수 있고, 한 관리주체는 여러 현장을 담당.
- 현장 법인과 관리주체 법인이 다르면 DB 트리거가 거부한다.
"""
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from supabase_client import db
from deps import get_current_user, require_admin
from services.sites_cache import invalidate_sites_cache

router = APIRouter()


def _site_counts() -> dict[int, int]:
    """managing_entity_id → 담당 현장 수."""
    r = (
        db()
        .from_("project_site")
        .select("managing_entity_id")
        .not_.is_("managing_entity_id", "null")
        .execute()
    )
    counts: dict[int, int] = {}
    for row in r.data or []:
        eid = row.get("managing_entity_id")
        if eid is None:
            continue
        counts[eid] = counts.get(eid, 0) + 1
    return counts


@router.get("/api/managing-entities")
def list_managing_entities(_user: dict = Depends(get_current_user)):
    """전체 관리주체 — 법인 정보 + 담당 현장 수 포함."""
    er = (
        db()
        .from_("managing_entity")
        .select("id,name,sort_order,corporation_id")
        .order("corporation_id")
        .order("sort_order")
        .order("id")
        .execute()
    )
    cr = db().from_("corporation").select("id,name").execute()
    corp_name = {c["id"]: c["name"] for c in (cr.data or [])}
    counts = _site_counts()
    out = []
    for e in er.data or []:
        out.append({
            "id": e["id"],
            "name": e["name"],
            "sort_order": e.get("sort_order") or 0,
            "corporation_id": e["corporation_id"],
            "corporation_name": corp_name.get(e["corporation_id"]),
            "site_count": counts.get(e["id"], 0),
        })
    return out


@router.post("/api/managing-entities")
def create_managing_entity(payload: dict = Body(...), admin: dict = Depends(require_admin)):
    name = (payload.get("name") or "").strip()
    corp_id = payload.get("corporation_id")
    sort_order = payload.get("sort_order") or 0
    if not name:
        raise HTTPException(status_code=400, detail="이름은 필수입니다")
    if not corp_id:
        raise HTTPException(status_code=400, detail="법인은 필수입니다")
    try:
        r = (
            db()
            .from_("managing_entity")
            .insert({"name": name, "corporation_id": int(corp_id), "sort_order": int(sort_order),
                     "created_by": admin["id"], "updated_by": admin["id"]})
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    row = (r.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="INSERT 결과가 비어 있음")
    invalidate_sites_cache()
    return {"ok": True, "entity": row}


@router.put("/api/managing-entities/{entity_id}")
def update_managing_entity(entity_id: int, payload: dict = Body(...), admin: dict = Depends(require_admin)):
    """이름/sort_order만 수정. 법인 이동은 사이트들과의 정합성 깨질 수 있어 막는다."""
    update: dict = {}
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="이름은 비울 수 없습니다")
        update["name"] = name
    if "sort_order" in payload and payload.get("sort_order") is not None:
        update["sort_order"] = int(payload["sort_order"])
    if not update:
        raise HTTPException(status_code=400, detail="수정할 필드가 없음")
    update["updated_by"] = admin["id"]
    try:
        r = (
            db()
            .from_("managing_entity")
            .update(update)
            .eq("id", entity_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    row = (r.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="관리주체를 찾을 수 없습니다")
    invalidate_sites_cache()
    return {"ok": True, "entity": row}


@router.delete("/api/managing-entities/{entity_id}")
def delete_managing_entity(entity_id: int, _admin: dict = Depends(require_admin)):
    """삭제 시 담당 현장의 managing_entity_id는 SET NULL."""
    try:
        r = (
            db()
            .from_("managing_entity")
            .delete()
            .eq("id", entity_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    invalidate_sites_cache()
    return {"ok": True, "deleted": len(r.data or [])}


@router.get("/api/managing-entities/{entity_id}/assignable-sites")
def assignable_sites(entity_id: int, _admin: dict = Depends(require_admin)):
    """이 주체가 담당할 수 있는 현장 — 같은 법인 사이트 전체.
    각 사이트의 현재 managing_entity_id도 같이 반환해서 UI가 체크 상태를
    표시할 수 있게 한다."""
    er = (
        db()
        .from_("managing_entity")
        .select("corporation_id")
        .eq("id", entity_id)
        .limit(1)
        .execute()
    )
    row = (er.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="관리주체를 찾을 수 없습니다")
    corp_id = row["corporation_id"]

    sr = (
        db()
        .from_("project_site")
        .select("id,name,managing_entity_id")
        .eq("corporation_id", corp_id)
        .order("name")
        .execute()
    )
    return sr.data or []


@router.put("/api/managing-entities/{entity_id}/sites")
def assign_sites(entity_id: int, payload: dict = Body(...), _admin: dict = Depends(require_admin)):
    """이 주체가 담당할 사이트 ID 리스트로 일괄 재할당.
    - 기존에 이 주체로 묶인 사이트 중 리스트에 없는 건 NULL로 해제
    - 리스트에 있는 사이트는 이 주체로 설정 (다른 주체에 묶여 있어도 덮어씀)
    - 사이트 법인이 주체 법인과 다르면 트리거가 거부 → 미리 검증
    """
    site_ids = payload.get("site_ids")
    if not isinstance(site_ids, list):
        raise HTTPException(status_code=400, detail="site_ids는 배열이어야 합니다")
    site_ids_int = [int(x) for x in site_ids]

    er = (
        db()
        .from_("managing_entity")
        .select("corporation_id")
        .eq("id", entity_id)
        .limit(1)
        .execute()
    )
    row = (er.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="관리주체를 찾을 수 없습니다")
    corp_id = row["corporation_id"]

    # 검증: 모든 site_ids가 같은 법인 사이트인지
    if site_ids_int:
        check = (
            db()
            .from_("project_site")
            .select("id,corporation_id")
            .in_("id", site_ids_int)
            .execute()
        )
        rows = check.data or []
        if len(rows) != len(site_ids_int):
            raise HTTPException(status_code=400, detail="존재하지 않는 site id가 포함되어 있음")
        bad = [r["id"] for r in rows if r["corporation_id"] != corp_id]
        if bad:
            raise HTTPException(status_code=400, detail=f"법인이 다른 현장은 할당할 수 없습니다 (id={bad})")

    # 1) 이 주체가 담당하던 사이트 중 리스트에 없는 건 해제
    current = (
        db()
        .from_("project_site")
        .select("id")
        .eq("managing_entity_id", entity_id)
        .execute()
    )
    current_ids = {r["id"] for r in (current.data or [])}
    to_unset = list(current_ids - set(site_ids_int))
    if to_unset:
        db().from_("project_site").update(
            {"managing_entity_id": None}
        ).in_("id", to_unset).execute()

    # 2) 리스트의 사이트는 이 주체로 설정 (이미 같은 값이어도 idempotent)
    if site_ids_int:
        db().from_("project_site").update(
            {"managing_entity_id": entity_id}
        ).in_("id", site_ids_int).execute()

    invalidate_sites_cache()
    return {"ok": True, "entity_id": entity_id, "assigned": len(site_ids_int), "unset": len(to_unset)}
