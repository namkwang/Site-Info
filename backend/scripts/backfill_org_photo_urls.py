"""Backfill: site_org_member.photo_url for members whose photo was uploaded
before the upload endpoint started persisting the URL.

The chart now renders <img> only when photo_url is set (avoids per-card 404
storms for members without photos). Members who already had `member_{id}.jpg`
in the bucket but never had photo_url written would otherwise lose their
photo until re-uploaded — this script restores them.

Idempotent: only updates rows where photo_url is currently NULL.
"""
import os
import re

from dotenv import load_dotenv
from supabase import create_client

# 우리 테이블이 사는 스키마. 팀 공용 프로젝트에서는 env 로 site_info 를 준다.
DB_SCHEMA = os.environ.get("DB_SCHEMA", "pmis")


load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

BUCKET = "org-photos"
NAME_RE = re.compile(r"^member_(\d+)\.jpg$")


def main() -> None:
    files = supabase.storage.from_(BUCKET).list("", {"limit": 10000})
    if not files:
        print("[backfill] no photos in bucket; nothing to do")
        return

    member_ids: list[int] = []
    for f in files:
        m = NAME_RE.match(f.get("name", ""))
        if m:
            member_ids.append(int(m.group(1)))
    print(f"[backfill] found {len(member_ids)} candidate photos")

    updated = 0
    for mid in member_ids:
        row = (
            supabase.schema(DB_SCHEMA)
            .from_("site_org_member")
            .select("id, photo_url")
            .eq("id", mid)
            .limit(1)
            .execute()
        )
        if not row.data:
            continue
        if row.data[0].get("photo_url"):
            continue
        public_url = supabase.storage.from_(BUCKET).get_public_url(f"member_{mid}.jpg")
        supabase.schema(DB_SCHEMA).from_("site_org_member").update(
            {"photo_url": public_url}
        ).eq("id", mid).execute()
        updated += 1

    print(f"[backfill] updated {updated} rows")


if __name__ == "__main__":
    main()
