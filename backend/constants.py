"""Shared business constants used across multiple routers and services.

Anything that's truly local to a single router stays inside that router file.
Constants land here only when at least two modules import them.
"""

# 발주유형 (order types) — kept as a Python set rather than a DB lookup table
# because the values are stable and exhaustive. Used by:
#   - routers/lookup.py    : exposes via /api/lookup/order-types
#                            and strips them out of /api/lookup/facility-types
#   - services/sites_cache : strips them from facility_type_name (dedup)
#   - filter parsers
ORDER_TYPES: set[str] = {"BTL", "CMR", "민간", "민참", "종심제"}

# 그룹 3사 — used in JV share aggregation and corporation rollups.
GROUP_COMPANIES: set[str] = {"남광토건", "극동건설", "금광기업"}


# ── 스토리지 버킷 ────────────────────────────────────────────
# 버킷은 프로젝트 전역 자원이라 스키마와 달리 이름이 한 벌뿐이다. 팀 공용
# 프로젝트의 기존 버킷들은 서비스 접두어를 쓴다(cons-attend-uploads,
# concrete-templates …). 우리 이름은 일반적이라 나중에 site-info- 접두어로
# 바꾸는 게 규약에 맞는데, 그때 이 두 상수만 고치면 되도록 모아 둔다.
# (프론트에도 같은 값이 web/src/lib/storage.ts 에 있으니 함께 바꿀 것)
BUCKET_ORG_PHOTOS = "org-photos"
BUCKET_SITE_IMAGES = "site-images"
