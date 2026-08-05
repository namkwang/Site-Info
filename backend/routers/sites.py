"""Site CRUD + filter options + image upload.

Reads (`/api/sites`, `/api/filter-options`) hit the in-memory cache from
`services.sites_cache`. Mutations bust that cache so the next read sees
fresh data.

JV/partner sync, address geocoding, and default-department seeding are
delegated to their own service modules so this router stays close to the
HTTP layer.
"""
import time
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
import traceback

from constants import BUCKET_SITE_IMAGES
from supabase_client import db, supabase
from deps import get_current_user, require_admin
from services.fail_log import log_failure
from services.geocode import persist_site_coords, resolve_region_code, sync_geocode
from services.org import seed_default_departments
from services.sites_cache import (
    SITES_CACHE_TTL,
    filter_sites_in_memory,
    get_all_sites_cached,
    invalidate_sites_cache,
)

router = APIRouter()


# ── Filter options ──────────────────────────────────────────

_FILTER_OPTIONS_CACHE: dict = {"data": None, "ts": 0.0}


@router.get("/api/filter-options")
async def get_filter_options(_user: dict = Depends(get_current_user)):
    """Derive filter options from the cached dashboard view. No extra DB round-trip."""
    now = time.time()
    cached = _FILTER_OPTIONS_CACHE["data"]
    if cached is not None and (now - _FILTER_OPTIONS_CACHE["ts"]) < SITES_CACHE_TTL:
        return cached

    sites = get_all_sites_cached()
    corporations = sorted({s.get("corporation_name") for s in sites if s.get("corporation_name")})
    regions = sorted({s.get("region_name") for s in sites if s.get("region_name")})
    order_types = sorted({s.get("order_type") for s in sites if s.get("order_type")})
    facility_types = sorted({s.get("facility_type_name") for s in sites if s.get("facility_type_name")})

    # 관리주체 — 사용 중/미사용 모두 노출 (admin이 미할당 주체로 필터링할 일은
    # 없지만, 새로 추가된 주체를 즉시 폼에서 쓸 수 있게 룩업 테이블 전체를 가져온다)
    # 마이그레이션 011 적용 전 환경에서는 테이블이 없을 수 있으므로 빈 리스트로 fallback.
    managing_entities: list[dict] = []
    try:
        er = (
            db()
            .from_("managing_entity")
            .select("id,name,corporation_id,sort_order")
            .order("corporation_id")
            .order("sort_order")
            .order("id")
            .execute()
        )
        cr = db().from_("corporation").select("id,name").execute()
        corp_name_by_id = {c["id"]: c["name"] for c in (cr.data or [])}
        managing_entities = [
            {
                "id": e["id"],
                "name": e["name"],
                "corporation_id": e["corporation_id"],
                "corporation_name": corp_name_by_id.get(e["corporation_id"]),
            }
            for e in (er.data or [])
        ]
    except Exception as e:
        # 테이블 미존재(마이그레이션 미적용) 또는 일시적 권한 오류 — 필터 자체를 비활성화하지는
        # 않고, 빈 리스트로 노출. 다른 필터/통계 정상 응답을 보장하는 게 우선.
        log_failure("sites.managing_entity_lookup", e)

    result = {
        "corporations": corporations,
        "regions": regions,
        "facilityTypes": facility_types,
        "orderTypes": order_types,
        "divisions": ["토목", "건축"],
        "statuses": ["ACTIVE", "COMPLETED", "SUSPENDED", "PRE_START"],
        "managingEntities": managing_entities,
    }
    _FILTER_OPTIONS_CACHE["data"] = result
    _FILTER_OPTIONS_CACHE["ts"] = now
    return result


# ── Sites read ──────────────────────────────────────────────

@router.get("/api/sites")
async def get_sites(
    corporation: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    facilityType: Optional[str] = Query(None),
    orderType: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    amountRanges: Optional[str] = Query(None),
    progressRanges: Optional[str] = Query(None),
    groupShareRanges: Optional[str] = Query(None),
    startYear: Optional[str] = Query(None),
    endYear: Optional[str] = Query(None),
    managingEntity: Optional[str] = Query(None),
    _user: dict = Depends(get_current_user),
):
    try:
        return filter_sites_in_memory(
            get_all_sites_cached(),
            corporation=corporation,
            region=region,
            facilityType=facilityType,
            orderType=orderType,
            division=division,
            status=status,
            search=search,
            amountRanges=amountRanges,
            progressRanges=progressRanges,
            groupShareRanges=groupShareRanges,
            startYear=startYear,
            endYear=endYear,
            managingEntity=managingEntity,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "trace": traceback.format_exc()},
        )


@router.get("/api/sites/{site_id}/raw")
def get_site_raw(site_id: int, _user: dict = Depends(get_current_user)):
    """편집 폼용 — project_site의 raw 컬럼 (특히 site_address) 반환."""
    r = (
        db()
        .from_("project_site")
        .select("id,office_address,site_address,latitude,longitude")
        .eq("id", site_id)
        .limit(1)
        .execute()
    )
    row = (r.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail=f"site id {site_id} 없음")
    return row


# ── Image upload ────────────────────────────────────────────

@router.post("/api/upload-site-image")
async def upload_site_image(file: UploadFile = File(...), site_id: str = Form(...), _admin: dict = Depends(require_admin)):
    """Upload or replace a site image to Supabase Storage."""
    content = await file.read()
    file_name = f"site_{site_id}.jpg"
    supabase.storage.from_(BUCKET_SITE_IMAGES).upload(
        file_name, content,
        file_options={"content-type": file.content_type or "image/jpeg", "upsert": "true"},
    )
    url = supabase.storage.from_(BUCKET_SITE_IMAGES).get_public_url(file_name)
    return {"ok": True, "url": url}


# ── Site mutation pipeline ──────────────────────────────────

EDITABLE_SITE_COLUMNS = {
    "name", "corporation_id", "division", "category",
    "region_code", "facility_type_code", "order_type", "client_org_id",
    "contract_amount", "start_date", "end_date",
    "office_address", "site_address", "latitude", "longitude",
    "status", "managing_entity_id", "pm_name",
}

REQUIRED_SITE_COLUMNS = {"name", "corporation_id", "division", "category"}


def _resolve_partner_name(name: str) -> int | None:
    name = (name or "").strip()
    if not name:
        return None
    existing = db().from_("partner_company").select("id,name").execute()
    for row in existing.data or []:
        if (row.get("name") or "").strip().lower() == name.lower():
            return row.get("id")
    ins = db().from_("partner_company").insert({"name": name}).execute()
    row = (ins.data or [None])[0]
    return row.get("id") if row else None


def _sync_jv_participation(site_id: int, corporation_id: int | None,
                           our_share_ratio: float | None,
                           jv_partners: list[dict] | None,
                           actor_id: str | None = None) -> None:
    """site_id의 jv_participation 행을 자사 + 하부업체로 재구성한다.
    - our_share_ratio: 자사 지분 % (0~100)
    - jv_partners: [{name, share_pct}] — 자사 외 파트너
    """
    if our_share_ratio is None and not jv_partners:
        return  # 변경 없음

    # 기존 행 모두 삭제 후 재삽입
    db().from_("jv_participation").delete().eq("site_id", site_id).execute()

    rows: list[dict] = []
    order = 0

    # 자사 행: corporation_id → corporation.name → partner_company 매칭/생성
    if corporation_id and our_share_ratio is not None:
        corp = db().from_("corporation").select("name").eq("id", corporation_id).limit(1).execute()
        corp_name = (corp.data or [{}])[0].get("name") if corp.data else None
        if corp_name:
            pid = _resolve_partner_name(corp_name)
            if pid:
                rows.append({
                    "site_id": site_id,
                    "partner_id": pid,
                    "share_pct": float(our_share_ratio),
                    "is_lead": True,
                    "contract_type": "MAIN",
                    "display_order": order,
                })
                order += 1

    for p in jv_partners or []:
        name = (p.get("name") or "").strip()
        share = p.get("share_pct")
        if not name or share in (None, ""):
            continue
        pid = _resolve_partner_name(name)
        if not pid:
            continue
        rows.append({
            "site_id": site_id,
            "partner_id": pid,
            "share_pct": float(share),
            "is_lead": False,
            "contract_type": "MAIN",
            "display_order": order,
        })
        order += 1

    if rows:
        if actor_id:
            for r in rows:
                r["created_by"] = actor_id
                r["updated_by"] = actor_id
        db().from_("jv_participation").insert(rows).execute()


def _resolve_client_name(name: str) -> int | None:
    """발주처 이름 → client_org.id. 없으면 새로 INSERT 후 id 반환."""
    name = (name or "").strip()
    if not name:
        return None
    existing = db().from_("client_org").select("id,name").execute()
    for row in existing.data or []:
        if (row.get("name") or "").strip().lower() == name.lower():
            return row.get("id")
    ins = db().from_("client_org").insert({"name": name}).execute()
    row = (ins.data or [None])[0]
    return row.get("id") if row else None


def _clean_site_payload(payload: dict) -> dict:
    """클라이언트 payload를 DB 컬럼에 맞게 정리.
    - 허용 컬럼만 남김
    - 빈 문자열 → None
    - 주소 있는데 좌표 없으면 지오코딩
    - client_name이 오면 client_org를 lookup/insert 후 client_org_id로 변환"""
    clean = {}
    if "client_name" in payload and "client_org_id" not in payload:
        cid = _resolve_client_name(payload.get("client_name") or "")
        clean["client_org_id"] = cid
    for k, v in payload.items():
        if k == "client_name":
            continue
        if k not in EDITABLE_SITE_COLUMNS:
            continue
        if v == "":
            v = None
        clean[k] = v

    # 지오코딩: site_address(지도 매칭용) 우선 → 없으면 office_address(표시용) 시도
    # 매칭 성공 시 site_address를 폴백에서 실제 매칭된 쿼리로 갱신해 box 2를 자동 채움
    candidates: list[str] = []
    if clean.get("site_address"):
        candidates.append(clean["site_address"])
    if clean.get("office_address") and clean.get("office_address") not in candidates:
        candidates.append(clean["office_address"])
    if candidates and (clean.get("latitude") is None or clean.get("longitude") is None):
        for addr in candidates:
            result = sync_geocode(addr)
            if result:
                clean["latitude"] = result[0]
                clean["longitude"] = result[1]
                clean["site_address"] = result[2]
                # region_code가 비어 있으면 지오코딩 결과로 자동 채움
                if not clean.get("region_code"):
                    rc = resolve_region_code(result[3])
                    if rc:
                        clean["region_code"] = rc
                break
    return clean


@router.post("/api/sites")
def create_site(payload: dict = Body(...), admin: dict = Depends(require_admin)):
    clean = _clean_site_payload(payload)
    clean["created_by"] = admin["id"]
    clean["updated_by"] = admin["id"]

    # If admin provides a status on create, pin it — otherwise auto_status
    # decides based on dates.
    if clean.get("status"):
        clean["status_manual"] = True

    missing = [k for k in REQUIRED_SITE_COLUMNS if clean.get(k) in (None, "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"필수 필드 누락: {', '.join(missing)}")

    try:
        res = db().from_("project_site").insert(clean).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")

    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="INSERT 결과가 비어 있음")

    _sync_jv_participation(
        site_id=row.get("id"),
        corporation_id=clean.get("corporation_id"),
        our_share_ratio=payload.get("our_share_ratio"),
        jv_partners=payload.get("jv_partners"),
        actor_id=admin["id"],
    )
    persist_site_coords(row.get("id"), clean.get("latitude"), clean.get("longitude"))
    try:
        seed_default_departments(row.get("id"))
    except Exception as e:
        log_failure("sites.default_department_seed", e, source_key=row.get("id"))
    invalidate_sites_cache()
    return {"ok": True, "id": row.get("id"), "site": row}


@router.put("/api/sites/{site_id}")
def update_site(site_id: int, payload: dict = Body(...), admin: dict = Depends(require_admin)):
    clean = _clean_site_payload(payload)

    # Admin changing status pins it — subsequent date-based auto_status
    # passes will skip this row.
    if "status" in clean:
        clean["status_manual"] = True

    has_jv_change = "our_share_ratio" in payload or "jv_partners" in payload
    if not clean and not has_jv_change:
        raise HTTPException(status_code=400, detail="수정할 필드가 없음")

    # updated_by 는 "빈 요청" 검증을 통과한 뒤에 넣는다 — 먼저 넣으면 clean 이
    # 절대 비지 않아 위 검증이 무력해진다.
    if clean:
        clean["updated_by"] = admin["id"]

    # 필수 컬럼이 payload에 포함되어 있으면 빈 값 방지
    for k in REQUIRED_SITE_COLUMNS:
        if k in clean and clean[k] in (None, ""):
            raise HTTPException(status_code=400, detail=f"{k}는 비울 수 없음")

    row = None
    if clean:
        try:
            res = db().from_("project_site").update(clean).eq("id", site_id).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
        row = (res.data or [None])[0]
        if not row:
            raise HTTPException(status_code=404, detail=f"site id {site_id} 없음")

    if has_jv_change:
        # corporation_id가 payload에 없으면 DB에서 조회
        corp_id = clean.get("corporation_id")
        if corp_id is None:
            r = db().from_("project_site").select("corporation_id").eq("id", site_id).limit(1).execute()
            corp_id = (r.data or [{}])[0].get("corporation_id") if r.data else None
        _sync_jv_participation(
            site_id=site_id,
            corporation_id=corp_id,
            our_share_ratio=payload.get("our_share_ratio"),
            jv_partners=payload.get("jv_partners"),
            actor_id=admin["id"],
        )

    if "latitude" in clean or "longitude" in clean:
        persist_site_coords(site_id, clean.get("latitude"), clean.get("longitude"))

    invalidate_sites_cache()
    return {"ok": True, "id": site_id, "site": row}


@router.delete("/api/sites/{site_id}")
def delete_site(site_id: int, _admin: dict = Depends(require_admin)):
    try:
        res = db().from_("project_site").delete().eq("id", site_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DB 오류: {e}")
    invalidate_sites_cache()
    return {"ok": True, "id": site_id, "deleted": len(res.data or [])}
