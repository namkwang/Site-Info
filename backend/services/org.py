"""Org-chart helpers shared between the org and sites routers.

`seed_default_departments` is called from two places:
  - org router, when /api/sites/{id}/departments is read for the first time
  - sites router, on site creation, so a brand-new site arrives with the
    standard team list already populated.
"""
from supabase_client import db

# 기본 부서 — 신규 현장 생성 시 자동 추가되는 팀 목록.
DEFAULT_DEPARTMENTS: list[tuple[str, int]] = [
    ("공무", 10),
    ("공사", 20),
    ("안전", 30),
]


def seed_default_departments(site_id: int) -> None:
    """Insert DEFAULT_DEPARTMENTS for a site if it has none yet. Idempotent."""
    existing = (
        db()
        .from_("site_department")
        .select("id")
        .eq("site_id", site_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return
    rows = [{"site_id": site_id, "name": n, "sort_order": o} for n, o in DEFAULT_DEPARTMENTS]
    db().from_("site_department").insert(rows).execute()
