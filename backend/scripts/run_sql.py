"""SQL 파일 또는 문자열을 Supabase Management API 로 실행한다.

`scripts/apply_migration.py` 는 Postgres 직결(DATABASE_URL)을 쓰는데, 그 경로가
막힌 환경에서도 마이그레이션을 적용할 수 있게 만든 대안이다. 대시보드 SQL
Editor 와 같은 경로를 쓴다 — `SUPABASE_ACCESS_TOKEN` 이 필요하다.

사용법:
    cd backend
    python scripts/run_sql.py --project <ref> -f ../db/migrations/017_app_fail_log.sql
    python scripts/run_sql.py --project <ref> -c "select count(*) from site_info.project_site"

    # 적용하지 않고 문법·실행 가능성만 확인 (BEGIN … ROLLBACK 으로 감싼다)
    python scripts/run_sql.py --project <ref> -f init.sql --dry-run
"""
import argparse
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

API = "https://api.supabase.com/v1"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Supabase project ref")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("-f", "--file", help="실행할 .sql 파일")
    g.add_argument("-c", "--command", help="실행할 SQL 문자열")
    ap.add_argument("--dry-run", action="store_true",
                    help="BEGIN … ROLLBACK 으로 감싸 실행만 검증하고 되돌린다")
    args = ap.parse_args()

    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("SUPABASE_ACCESS_TOKEN 이 없습니다 (backend/.env).", file=sys.stderr)
        return 2

    sql = Path(args.file).read_text(encoding="utf-8") if args.file else args.command

    if args.dry_run:
        # 파일 최상위의 BEGIN/COMMIT 만 걷어내고 우리 트랜잭션으로 감싼다.
        # 모든 BEGIN;/END; 를 지우면 안 된다 — plpgsql 함수 본문에도 같은
        # 키워드가 들어 있어 함수 정의가 깨진다.
        lines = sql.splitlines()
        first_begin = next(
            (i for i, l in enumerate(lines) if l.strip().upper() == "BEGIN;"), None)
        if first_begin is not None:
            lines.pop(first_begin)
        last_commit = next(
            (i for i in range(len(lines) - 1, -1, -1)
             if lines[i].strip().upper() == "COMMIT;"), None)
        if last_commit is not None:
            lines.pop(last_commit)
        sql = "BEGIN;\n" + "\n".join(lines) + "\nROLLBACK;"
        print("[dry-run] BEGIN … ROLLBACK 으로 실행 — 아무것도 남지 않는다", file=sys.stderr)

    r = httpx.post(
        f"{API}/projects/{args.project}/database/query",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=300,
    )
    if r.status_code >= 400:
        print(f"[실패 {r.status_code}] {r.text[:1500]}", file=sys.stderr)
        return 1
    try:
        data = r.json()
    except Exception:
        print(r.text[:1000]); return 0
    print(json.dumps(data, ensure_ascii=False, indent=1)[:3000] if data else "OK (반환 행 없음)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
