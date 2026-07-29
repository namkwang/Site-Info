"""Geocoding service — Kakao Local API wrappers + on-disk coord cache.

The dashboard view (`v_site_dashboard`) does not surface lat/lon. We keep
per-site coordinates in `site_coordinates.json` and merge them in via
`attach_coords()` in services/sites_cache. Mutations (site create/update,
batch geocode) write straight to that file so the cache stays in sync.

Two geocoding entry points:
  - geocode_address (async)  — used by the batch /api/geocode endpoint
  - sync_geocode             — used by the site CRUD path; tries address API
                               then keyword API, then drops trailing words.
                               Returns the matched address text + Kakao's
                               region_1depth_name for region_code mapping.
"""
import json
from typing import Optional

import httpx

from supabase_client import supabase, KAKAO_REST_KEY, COORDS_FILE


def load_coords() -> dict[str, dict]:
    """Load cached coordinates from JSON file."""
    if COORDS_FILE.exists():
        return json.loads(COORDS_FILE.read_text(encoding="utf-8"))
    return {}


def save_coords(coords: dict[str, dict]):
    """Save coordinates to JSON file."""
    COORDS_FILE.write_text(json.dumps(coords, ensure_ascii=False, indent=2), encoding="utf-8")


def persist_site_coords(site_id: int | None, lat: float | None, lon: float | None) -> None:
    """site_coordinates.json에 좌표 즉시 반영. attach_coords()가 이 파일을 우선
    사용하므로 DB만 갱신해서는 대시보드에 좌표가 안 보임."""
    if site_id is None:
        return
    coords = load_coords()
    key = str(site_id)
    if lat is not None and lon is not None:
        coords[key] = {"latitude": float(lat), "longitude": float(lon)}
    else:
        coords.pop(key, None)
    save_coords(coords)


async def geocode_address(client: httpx.AsyncClient, address: str) -> tuple[float, float] | None:
    """Kakao Local API: address -> (latitude, longitude). Async — used by the
    batch endpoint that geocodes every site at once."""
    try:
        res = await client.get(
            "https://dapi.kakao.com/v2/local/search/address.json",
            params={"query": address},
            headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
            timeout=10,
        )
        data = res.json()
        docs = data.get("documents", [])
        if docs:
            return (float(docs[0]["y"]), float(docs[0]["x"]))
    except Exception:
        pass
    return None


def sync_geocode(address: str) -> tuple[float, float, str, str | None] | None:
    """동기 Kakao 지오코딩. 관대한 매칭을 위해 여러 단계로 fallback.
    반환: (위도, 경도, 매칭된 정식 주소/장소명, region_1depth_name) — 마지막 값은
    Kakao가 알려준 시/도(예: '강원', '경기'). 호출자가 region_code 자동 매핑에 사용.
       1) 주소 검색 API — 도로명/지번 정형 주소
       2) 키워드 검색 API — 장소명/랜드마크/일반 키워드
       3) 주소 단어 수를 줄여가며 재시도
    """
    if not KAKAO_REST_KEY or not address:
        return None
    address = address.strip()
    if not address:
        return None
    # 단어를 줄여가며 여러 번 호출할 수 있으므로 클라이언트 하나를 재사용한다.
    with httpx.Client(
        headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}, timeout=10,
    ) as client:

        def _try_address(q: str) -> tuple[float, float, str, str | None] | None:
            try:
                res = client.get(
                    "https://dapi.kakao.com/v2/local/search/address.json",
                    params={"query": q},
                )
                docs = res.json().get("documents", [])
                if docs:
                    d = docs[0]
                    ra = d.get("road_address") or {}
                    ad = d.get("address") or {}
                    name = ra.get("address_name") or ad.get("address_name") or d.get("address_name") or q
                    region = ra.get("region_1depth_name") or ad.get("region_1depth_name")
                    return (float(d["y"]), float(d["x"]), name, region)
            except Exception:
                pass
            return None

        def _try_keyword(q: str) -> tuple[float, float, str, str | None] | None:
            try:
                res = client.get(
                    "https://dapi.kakao.com/v2/local/search/keyword.json",
                    params={"query": q, "size": 1},
                )
                docs = res.json().get("documents", [])
                if docs:
                    d = docs[0]
                    name = d.get("place_name") or d.get("road_address_name") or d.get("address_name") or q
                    # 키워드 응답에는 region_1depth_name가 없으므로 address_name 첫 단어로 추론
                    addr = d.get("address_name") or d.get("road_address_name") or ""
                    region = addr.split()[0] if addr else None
                    return (float(d["y"]), float(d["x"]), name, region)
            except Exception:
                pass
            return None

        r = _try_address(address)
        if r:
            return r
        r = _try_keyword(address)
        if r:
            return r
        parts = address.split()
        while len(parts) > 1:
            parts.pop()
            q = " ".join(parts)
            r = _try_address(q) or _try_keyword(q)
            if r:
                return r
        return None


def resolve_region_code(region_name: str | None) -> str | None:
    """Kakao region_1depth_name(예: '강원', '경기') → region_code 테이블의 code.
    이름 매칭 (앞 2글자 부분 일치 허용 — '강원' vs '강원도', '서울' vs '서울특별시')."""
    if not region_name:
        return None
    n = region_name.strip()
    if not n:
        return None
    try:
        r = supabase.schema("pmis").from_("region_code").select("code,name").execute()
    except Exception:
        return None
    rows = r.data or []
    # 정확 일치 우선
    for row in rows:
        if (row.get("name") or "").strip() == n:
            return row.get("code")
    # 부분 일치 (양방향)
    for row in rows:
        rn = (row.get("name") or "").strip()
        if rn.startswith(n) or n.startswith(rn):
            return row.get("code")
    return None
