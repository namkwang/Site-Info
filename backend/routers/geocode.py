"""Geocoding endpoints — admin only.

  POST /api/geocode          — batch geocode every site that has an
                                office_address but no cached coords yet.
  POST /api/geocode/preview  — preview a single address (no save) for the
                                site form's '좌표 매칭하기' button.
"""
from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
import httpx

from supabase_client import db, KAKAO_REST_KEY
from deps import require_admin
from services.geocode import (
    geocode_address,
    load_coords,
    resolve_region_code,
    save_coords,
    sync_geocode,
)

router = APIRouter()


@router.post("/api/geocode")
async def geocode_all_sites(_admin: dict = Depends(require_admin)):
    """Batch geocode all sites with office_address and cache results."""
    if not KAKAO_REST_KEY:
        return JSONResponse(status_code=400, content={"error": "KAKAO_REST_KEY not configured"})

    response = db().from_("v_site_dashboard").select("id, site_name, office_address").execute()
    sites = response.data or []

    coords = load_coords()
    results = {"total": len(sites), "geocoded": 0, "skipped": 0, "failed": 0, "failed_sites": []}

    async with httpx.AsyncClient() as client:
        for site in sites:
            site_id = str(site["id"])
            address = site.get("office_address")

            if not address:
                results["skipped"] += 1
                continue

            # Skip already geocoded
            if site_id in coords:
                results["skipped"] += 1
                continue

            result = await geocode_address(client, address)
            if result:
                coords[site_id] = {"latitude": result[0], "longitude": result[1]}
                results["geocoded"] += 1
            else:
                results["failed"] += 1
                results["failed_sites"].append({"id": site["id"], "name": site["site_name"], "address": address})

    save_coords(coords)
    return results


@router.post("/api/geocode/preview")
def geocode_preview(payload: dict = Body(...), _admin: dict = Depends(require_admin)):
    """저장 없이 주소 → 좌표 미리보기. 폼의 '좌표 매칭하기' 버튼용."""
    address = (payload.get("address") or "").strip()
    if not address:
        return {"ok": False, "reason": "주소가 비어 있습니다"}
    result = sync_geocode(address)
    if not result:
        return {"ok": False, "reason": "Kakao 주소 검색에서 매칭 결과가 없습니다"}
    region_code = resolve_region_code(result[3])
    return {
        "ok": True,
        "latitude": result[0],
        "longitude": result[1],
        "matched_address": result[2],
        "region_name": result[3],
        "region_code": region_code,
    }
