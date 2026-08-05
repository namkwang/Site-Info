"""In-memory dashboard cache + filter pipeline.

Supabase round-trips are the dominant latency for /api/sites and
/api/statistics/summary (~400ms each). Filters change rapidly under
Power BI-style cross-filtering, so we fetch the full dashboard view once,
cache it, and apply all filters in-memory afterwards. TTL is short enough
that DB updates surface within a minute without manual invalidation.

Both the sites router and the statistics router pull from this cache via
`get_all_sites_cached()` and then apply `filter_sites_in_memory(...)`.
Mutations (site create/update/delete) call `invalidate_sites_cache()`.
"""
import re
import threading
import time
from datetime import date
from typing import Optional

from supabase_client import db
from constants import GROUP_COMPANIES, ORDER_TYPES
from services.fail_log import log_failure
from services.geocode import load_coords


# ── Enrichment helpers ──────────────────────────────────────

def _parse_jv_shares(jv_summary: str | None) -> dict[str, float]:
    """Parse JV summary string into {company: ratio}.
    Example: '극동건설 65.00%, 오렌지 20.00%' -> {'극동건설': 0.65, '오렌지': 0.20}
    """
    if not jv_summary:
        return {}
    result = {}
    for part in jv_summary.split(","):
        part = part.strip()
        m = re.match(r"(.+?)\s+([\d.]+)%", part)
        if m:
            result[m.group(1).strip()] = float(m.group(2)) / 100
    return result


def calc_group_share(site: dict) -> dict:
    """Calculate our_share_amount and group_share_amount for a site.
    - our_share_amount: 해당 현장 법인의 지분 도급액
    - group_share_amount: 그룹 3사 합산 지분 도급액
    """
    contract = site.get("contract_amount") or 0
    corp = site.get("corporation_name") or ""
    shares = _parse_jv_shares(site.get("jv_summary"))

    # 자사(현장 법인) 지분
    our_ratio = shares.get(corp, 1.0)  # JV 없으면 100%
    our_amount = round(contract * our_ratio)

    # 그룹 3사 합산 지분 (JV 없으면 소유 법인이 100%)
    if shares:
        group_ratio = sum(r for c, r in shares.items() if c in GROUP_COMPANIES)
    else:
        group_ratio = 1.0 if corp in GROUP_COMPANIES else 0.0
    group_amount = round(contract * group_ratio)

    site["our_share_amount"] = our_amount
    site["group_share_amount"] = group_amount
    site["our_share_ratio"] = round(our_ratio, 4)
    site["group_share_ratio"] = round(group_ratio, 4)
    return site


def attach_share_amounts(sites: list[dict]) -> list[dict]:
    for site in sites:
        calc_group_share(site)
    return sites


def auto_status(sites: list[dict]) -> list[dict]:
    """start_date/end_date 기준으로 status 자동 판정.
    - start_date > 오늘 → PRE_START
    - start_date <= 오늘 && (end_date 없음 || end_date >= 오늘) → ACTIVE
    - end_date < 오늘 → 저장된 status 유지 (준공 자동 전환 없음 — 준공은 관리자가 직접 지정)
    SUSPENDED와 status_manual=true는 관리자 편집이 우선이라 건드리지 않는다.
    """
    today = date.today().isoformat()
    for s in sites:
        if s.get("status") == "SUSPENDED":
            continue
        if s.get("status_manual"):
            continue
        sd = s.get("start_date")
        ed = s.get("end_date")
        if sd and sd > today:
            s["status"] = "PRE_START"
        elif ed and ed < today:
            continue
        elif sd and sd <= today:
            s["status"] = "ACTIVE"
    return sites


def clean_facility_type(sites: list[dict]) -> list[dict]:
    """facility_type_name이 발주유형과 동일하면 비워서 중복 표시 방지."""
    for site in sites:
        ft = site.get("facility_type_name") or ""
        if ft in ORDER_TYPES:
            site["facility_type_name"] = None
    return sites


def attach_coords(sites: list[dict]) -> list[dict]:
    """Attach latitude/longitude from cached coordinates."""
    coords = load_coords()
    for site in sites:
        site_id = str(site["id"])
        if site_id in coords:
            site["latitude"] = coords[site_id]["latitude"]
            site["longitude"] = coords[site_id]["longitude"]
        else:
            site["latitude"] = None
            site["longitude"] = None
    return sites


# ── Cache state ─────────────────────────────────────────────

_SITES_CACHE: dict = {"data": None, "ts": 0.0}
SITES_CACHE_TTL = 60.0  # seconds
_REFRESH_LOCK = threading.Lock()  # 백그라운드 갱신 single-flight


def get_all_sites_cached() -> list[dict]:
    """Return the full dashboard site list, fetching from Supabase only when
    the in-memory cache is empty or stale. Result is already deduped and
    enriched (clean_facility_type + attach_share_amounts + attach_coords).

    Stale-while-revalidate: TTL이 지나도 기존 데이터를 즉시 반환하고 갱신은
    백그라운드 스레드에 맡긴다. 리빌드(0.5~2초)를 요청이 기다리는 건 캐시가
    아예 빈 경우(기동 직후, invalidate 직후)뿐이다."""
    now = time.time()
    cached = _SITES_CACHE["data"]
    if cached is not None:
        if (now - _SITES_CACHE["ts"]) >= SITES_CACHE_TTL and _REFRESH_LOCK.acquire(blocking=False):
            threading.Thread(target=_refresh_in_background, daemon=True).start()
        return cached
    return _rebuild_sites()


def _refresh_in_background() -> None:
    """Refresh the cache off the request path. Caller must hold _REFRESH_LOCK."""
    try:
        _rebuild_sites()
    except Exception as e:
        # 기존 stale 데이터 유지 — 다음 요청이 다시 시도한다. 다만 갱신이
        # 계속 실패하면 화면이 조용히 낡아가므로 흔적은 남긴다.
        log_failure("sites_cache.background_refresh", e)
    finally:
        _REFRESH_LOCK.release()


def _rebuild_sites() -> list[dict]:
    response = (
        db()
        .from_("v_site_dashboard")
        .select("*")
        .order("progress_rate", desc=False)
        .execute()
    )
    raw = response.data or []

    # Deduplicate by site_name + corporation_code
    seen = set()
    deduped: list[dict] = []
    for s in raw:
        key = f"{s.get('site_name')}::{s.get('corporation_code')}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)

    deduped = clean_facility_type(deduped)

    # status_manual flag lives on project_site, not the dashboard view.
    # Merge it in so auto_status() can skip admin-pinned rows.
    try:
        manual_resp = db().from_("project_site").select("id,status_manual").execute()
        manual_map = {r["id"]: bool(r.get("status_manual")) for r in (manual_resp.data or [])}
    except Exception as e:
        # 이 조회가 실패하면 관리자가 고정한 상태가 auto_status 에 덮여
        # 화면 상태값이 조용히 틀려진다 — 반드시 남긴다.
        log_failure("sites_cache.status_manual_merge", e)
        manual_map = {}
    for s in deduped:
        s["status_manual"] = manual_map.get(s.get("id"), False)

    deduped = auto_status(deduped)
    deduped = attach_share_amounts(deduped)
    deduped = attach_coords(deduped)

    _SITES_CACHE["data"] = deduped
    _SITES_CACHE["ts"] = time.time()
    return deduped


def invalidate_sites_cache() -> None:
    """Bust the in-memory sites cache. Call from any mutation that changes
    project_site / jv_participation / coordinates."""
    _SITES_CACHE["data"] = None
    _SITES_CACHE["ts"] = 0.0


# ── Filter pipeline ─────────────────────────────────────────

def parse_ranges(raw: str) -> list[dict]:
    """'100-500,1000-2000' -> [{'min': 100, 'max': 500}, ...]"""
    result = []
    for r in raw.split(","):
        r = r.strip()
        if not r:
            continue
        parts = r.split("-")
        lo = float(parts[0])
        hi = float("inf") if parts[1] == "" else float(parts[1])
        result.append({"min": lo, "max": hi})
    return result


def _split_csv(v: Optional[str]) -> Optional[list[str]]:
    if not v or v == "all":
        return None
    parts = [p.strip() for p in v.split(",") if p.strip() and p.strip() != "all"]
    return parts or None


def _date_to_ym(d: str) -> str:
    """'2026-03-01' -> '26.03'"""
    return f"{d[2:4]}.{d[5:7]}"


def filter_sites_in_memory(
    sites: list[dict],
    corporation: Optional[str] = None,
    region: Optional[str] = None,
    facilityType: Optional[str] = None,
    orderType: Optional[str] = None,
    division: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    amountRanges: Optional[str] = None,
    progressRanges: Optional[str] = None,
    groupShareRanges: Optional[str] = None,
    startYear: Optional[str] = None,
    endYear: Optional[str] = None,
    managingEntity: Optional[str] = None,
) -> list[dict]:
    """Apply the same filter logic as the previous Supabase queries, but
    against an in-memory list. Used by both /api/sites and the summary
    endpoint so they share a single cached source of truth."""
    corp_list = _split_csv(corporation)
    region_list = _split_csv(region)
    facility_list = _split_csv(facilityType)
    order_list = _split_csv(orderType)
    division_list = _split_csv(division)
    status_list = _split_csv(status)
    entity_list = _split_csv(managingEntity)
    search_lc = (search or "").strip().lower() or None

    out = sites
    if corp_list:
        cs = set(corp_list)
        out = [s for s in out if s.get("corporation_name") in cs]
    if region_list:
        rs = set(region_list)
        out = [s for s in out if s.get("region_name") in rs]
    if facility_list:
        fs = set(facility_list)
        out = [s for s in out if s.get("facility_type_name") in fs]
    if order_list:
        os_ = set(order_list)
        out = [s for s in out if s.get("order_type") in os_]
    if division_list:
        ds = set(division_list)
        out = [s for s in out if s.get("division") in ds]
    if status_list:
        ss = set(status_list)
        out = [s for s in out if s.get("status") in ss]
    if entity_list:
        es = {int(x) for x in entity_list if x.isdigit()}
        out = [s for s in out if s.get("managing_entity_id") in es]
    if search_lc:
        out = [s for s in out if search_lc in (s.get("site_name") or "").lower()]
    if amountRanges:
        ranges = parse_ranges(amountRanges)
        out = [
            s for s in out
            if any(r["min"] <= (s.get("contract_amount") or 0) < r["max"] for r in ranges)
        ]
    if progressRanges:
        ranges = parse_ranges(progressRanges)
        out = [
            s for s in out
            if any(r["min"] <= (s.get("progress_rate") or 0) * 100 < r["max"] for r in ranges)
        ]
    if groupShareRanges:
        ranges = parse_ranges(groupShareRanges)
        out = [
            s for s in out
            if any(r["min"] <= (s.get("group_share_amount") or 0) < r["max"] for r in ranges)
        ]
    if startYear:
        out = [s for s in out if s.get("start_date") and _date_to_ym(s["start_date"]) == startYear]
    if endYear:
        out = [s for s in out if s.get("end_date") and s["end_date"][:4] == endYear]
    return out
