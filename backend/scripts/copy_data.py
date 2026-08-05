"""프로젝트 간 데이터 복사 (개인 pmis → 팀 site_info).

두 프로젝트의 REST API 를 service_role 로 붙어 테이블 단위로 읽고 쓴다.
id 를 그대로 보존하므로 참조 관계가 유지되고, 마지막에 시퀀스를 max(id) 로
맞춘다.

원칙:
  - **FK 순서대로** 복사한다. 순서가 틀리면 참조 오류로 실패한다.
  - site_org_member 는 자기 자신(parent_id)을 참조하므로 2단계로 넣는다:
    먼저 parent_id 를 비운 채 전부 넣고, 그 다음 parent_id 만 채운다.
  - user_profile 은 **복사하지 않는다**. 행의 id 는 개인 프로젝트 auth 계정의
    UUID 라 팀 프로젝트에는 대응하는 계정이 없다. 게다가 email 이 UNIQUE 라
    사용자가 팀 프로젝트에서 새로 가입하는 순간 충돌한다. 사용자는 재가입하고
    관리자가 다시 승인한다(22명, 1회성).
  - 대상 테이블이 비어 있지 않으면 중단한다. 두 번 돌려 데이터가 겹치는 사고를
    막는다(--force 로 무시 가능).

사용법:
    cd backend
    python scripts/copy_data.py --dry-run     # 무엇을 얼마나 옮길지만 출력
    python scripts/copy_data.py
"""
import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# FK 의존 순서. 앞에 있는 것이 먼저 존재해야 뒤가 들어간다.
ORDER = [
    "corporation",
    "region_code",
    "facility_type",
    "client_org",
    "partner_company",
    "org_role",
    "managing_entity",     # → corporation
    "project_site",        # → corporation, region_code, facility_type, client_org, managing_entity
    "site_department",     # site_id
    "site_org_member",     # → org_role, site_department, self(parent_id)
    "jv_participation",    # → project_site, partner_company
    "site_memo",           # → project_site
]

# 옮기지 않는 것과 이유
SKIP = {
    "user_profile": "auth 계정 UUID 가 프로젝트 간 이전 불가 + email UNIQUE 충돌. 재가입/재승인.",
    "app_fail_log": "운영 로그. 개인 프로젝트의 기록을 팀 DB 로 옮길 이유가 없다.",
}

PAGE = 500  # REST 한 번에 읽고 쓰는 행 수

# 대부분 id 지만 코드 마스터는 PK 가 code 다. 페이지네이션 정렬 키로 쓴다.
PK = {"region_code": "code", "facility_type": "code"}


def pk(table: str) -> str:
    return PK.get(table, "id")


def client(url: str, key: str, schema: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{url}/rest/v1",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept-Profile": schema,
            "Content-Profile": schema,
        },
        timeout=120,
    )


def read_all(c: httpx.Client, table: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        r = c.get(f"/{table}", params={"select": "*", "order": pk(table),
                                       "limit": PAGE, "offset": offset})
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


def count(c: httpx.Client, table: str) -> int:
    r = c.get(f"/{table}", params={"select": pk(table), "limit": 1},
              headers={"Prefer": "count=exact", "Range": "0-0"})
    cr = r.headers.get("content-range", "")
    return int(cr.split("/")[-1]) if "/" in cr and cr.split("/")[-1].isdigit() else -1


def insert(c: httpx.Client, table: str, rows: list[dict]) -> None:
    for i in range(0, len(rows), PAGE):
        chunk = rows[i:i + PAGE]
        r = c.post(f"/{table}", json=chunk, headers={"Prefer": "return=minimal"})
        if r.status_code >= 400:
            raise SystemExit(f"[{table}] INSERT 실패 {r.status_code}: {r.text[:600]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="읽기만 하고 쓰지 않는다")
    ap.add_argument("--force", action="store_true", help="대상이 비어 있지 않아도 진행")
    args = ap.parse_args()

    src_url, src_key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    dst_url = os.environ["PROD_SUPABASE_URL"]
    dst_key = os.environ["PROD_SUPABASE_SERVICE_ROLE_KEY"]
    src_schema = os.environ.get("DB_SCHEMA", "pmis")
    dst_schema = os.environ.get("PROD_DB_SCHEMA", "site_info")

    print(f"원본: {src_url.split('//')[1].split('.')[0]} / {src_schema}")
    print(f"대상: {dst_url.split('//')[1].split('.')[0]} / {dst_schema}")
    print(f"건너뜀: {', '.join(SKIP)}\n")

    src = client(src_url, src_key, src_schema)
    dst = client(dst_url, dst_key, dst_schema)

    # 1) 대상이 비어 있는지 먼저 전부 확인 — 중간에 멈추면 정리가 번거롭다.
    if not args.force:
        dirty = [(t, n) for t in ORDER if (n := count(dst, t)) > 0]
        if dirty:
            print("대상 테이블이 비어 있지 않습니다:", file=sys.stderr)
            for t, n in dirty:
                print(f"  {t}: {n}행", file=sys.stderr)
            print("이미 이관됐거나 실패 후 잔여 데이터일 수 있습니다. "
                  "확인 후 --force 를 쓰세요.", file=sys.stderr)
            return 1

    total = 0
    for table in ORDER:
        rows = read_all(src, table)
        if not rows:
            print(f"  {table:20} 0행 — 건너뜀")
            continue

        if table == "site_org_member":
            # 자기 참조 → parent_id 를 비운 채 넣고 나중에 채운다
            parents = {r["id"]: r.get("parent_id") for r in rows if r.get("parent_id") is not None}
            body = [{**r, "parent_id": None} for r in rows]
            print(f"  {table:20} {len(rows)}행 (parent_id {len(parents)}건은 2단계)")
            if not args.dry_run:
                insert(dst, table, body)
                for mid, pid in parents.items():
                    r = dst.patch(f"/{table}", params={"id": f"eq.{mid}"},
                                  json={"parent_id": pid},
                                  headers={"Prefer": "return=minimal"})
                    if r.status_code >= 400:
                        raise SystemExit(f"[{table}] parent_id 갱신 실패: {r.text[:300]}")
        else:
            print(f"  {table:20} {len(rows)}행")
            if not args.dry_run:
                insert(dst, table, rows)
        total += len(rows)

    print(f"\n총 {total}행")

    if args.dry_run:
        print("(dry-run — 아무것도 쓰지 않았다)")
        return 0

    # 2) 검증: 원본과 대상 행 수 비교
    print("\n행 수 검증:")
    bad = []
    for table in ORDER:
        s, d = count(src, table), count(dst, table)
        mark = "OK" if s == d else "불일치"
        if s != d:
            bad.append(table)
        print(f"  {table:20} 원본 {s:>5} / 대상 {d:>5}  {mark}")
    if bad:
        print(f"\n불일치 테이블: {', '.join(bad)}", file=sys.stderr)
        return 1

    print("\n시퀀스는 scripts/run_sql.py 로 setval 해야 한다 (--print-setval 참고)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
