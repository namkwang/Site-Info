"""기존 사용자의 비밀번호 해시를 우리 스키마로 옮긴다.

로그인을 Supabase Auth 에서 우리 쪽(site_info.user_credential)으로 가져오면서,
사용자가 쓰던 비밀번호를 그대로 쓸 수 있게 하는 스크립트다. Supabase 도
bcrypt($2a$)를 쓰므로 해시를 그대로 넣으면 검증이 된다 — 평문을 아는 사람이
아무도 없어도 이전이 가능하다.

해시는 개인 프로젝트의 `auth.users` 에서 읽는다. 팀 프로젝트가 아니라 개인
프로젝트인 이유: 팀 프로젝트에 원래 계정이 있던 4명은 우리가 만든 계정이 아니고
그 비밀번호는 조직 계정 것이라 우리가 가져올 대상이 아니다. 그 4명은 우리 쪽
비밀번호를 새로 지정해야 한다(`POST /api/users/{id}/password`).

이메일로 대조한다 — id 는 팀 프로젝트에서 바뀐 사람이 있다.

사용법:
    cd backend
    python scripts/import_password_hashes.py --dry-run
    python scripts/import_password_hashes.py
"""
import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

# scripts/ 에서 실행해도 backend/ 의 모듈(services, supabase_client)을 찾게 한다.
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
load_dotenv(BACKEND / ".env")

MGMT = "https://api.supabase.com/v1"


def sql(project: str, token: str, query: str) -> list[dict]:
    r = httpx.post(f"{MGMT}/projects/{project}/database/query",
                   headers={"Authorization": f"Bearer {token}",
                            "Content-Type": "application/json"},
                   json={"query": query}, timeout=180)
    if r.status_code >= 400:
        raise SystemExit(f"[SQL 실패 {r.status_code}] {r.text[:300]}")
    d = r.json()
    return d if isinstance(d, list) else []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source-project", default="mpoufkwszfihkufkundx",
                    help="해시를 읽어올 프로젝트 (개인 프로젝트)")
    ap.add_argument("--overwrite", action="store_true",
                    help="이미 비밀번호가 설정된 사용자도 덮어쓴다")
    args = ap.parse_args()

    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("SUPABASE_ACCESS_TOKEN 이 필요합니다 (해시 조회).", file=sys.stderr)
        return 2

    # 우리 스키마의 사용자 목록
    from services import credentials as creds  # noqa: E402
    from supabase_client import db  # noqa: E402

    profiles = db().from_("user_profile").select("id,email").execute().data or []
    by_email = {p["email"].strip().lower(): p["id"] for p in profiles}
    print(f"우리 스키마 사용자: {len(profiles)}명")

    # 원본 해시 (이메일 → 해시)
    src = sql(args.source_project, token, """
        select lower(email) as email, encrypted_password
          from auth.users
         where encrypted_password is not null
    """)
    hashes = {r["email"]: r["encrypted_password"] for r in src if r.get("email")}
    print(f"원본 해시: {len(hashes)}건")

    matched = [(e, uid) for e, uid in by_email.items() if e in hashes]
    missing = [e for e in by_email if e not in hashes]
    print(f"  대조 성공: {len(matched)}명")
    if missing:
        print(f"  해시 없음: {len(missing)}명 — 비밀번호를 새로 지정해야 한다")
        for e in missing:
            print(f"     {e[:3]}***@{e.split('@')[1]}")

    if args.dry_run:
        print("\n(dry-run) 아무것도 쓰지 않았다")
        return 0

    done = skipped = 0
    for email, uid in matched:
        if not args.overwrite and creds.has_credential(uid):
            skipped += 1
            continue
        creds.set_password_hash(uid, hashes[email])
        done += 1
    print(f"\n이전 완료: {done}명" + (f" / 이미 설정돼 건너뜀 {skipped}명" if skipped else ""))

    total = len(db().from_("user_credential").select("user_id").execute().data or [])
    print(f"user_credential 총 {total}행 / 프로필 {len(profiles)}명")
    if total < len(profiles):
        print(f"비밀번호 미설정 {len(profiles) - total}명 — 관리자가 지정해야 로그인 가능",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
