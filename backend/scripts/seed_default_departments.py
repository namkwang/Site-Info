"""Backfill: 부서가 하나도 없는 기존 현장에 기본 5팀(공무/공사/기계·토목/품질/안전) 추가.

멱등 — 이미 부서가 있는 현장은 건너뛴다.
"""
from supabase import create_client

from dotenv import load_dotenv
import os

# 우리 테이블이 사는 스키마. 팀 공용 프로젝트에서는 env 로 site_info 를 준다.
DB_SCHEMA = os.environ.get("DB_SCHEMA", "pmis")

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

DEFAULT_DEPARTMENTS: list[tuple[str, int]] = [
    ("공무", 10),
    ("공사", 20),
    ("전기/기계/토목", 30),
    ("품질", 40),
    ("안전", 50),
]


def main() -> None:
    sites = supabase.schema(DB_SCHEMA).from_("project_site").select("id,name").execute()
    if not sites.data:
        print("현장 없음")
        return
    seeded = 0
    skipped = 0
    for s in sites.data:
        sid = s["id"]
        existing = supabase.schema(DB_SCHEMA).from_("site_department") \
            .select("id").eq("site_id", sid).limit(1).execute()
        if existing.data:
            skipped += 1
            continue
        rows = [{"site_id": sid, "name": n, "sort_order": o} for n, o in DEFAULT_DEPARTMENTS]
        supabase.schema(DB_SCHEMA).from_("site_department").insert(rows).execute()
        seeded += 1
        print(f"  + {s.get('name')} (id {sid}): {len(rows)}팀 추가")
    print(f"\n=== 완료: {seeded}개 현장 시드, {skipped}개 현장 건너뜀 ===")


if __name__ == "__main__":
    main()
