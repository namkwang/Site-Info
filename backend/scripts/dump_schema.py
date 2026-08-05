"""스키마 하나의 DDL 을 실제 DB 에서 뽑아 SQL 파일로 출력한다.

왜 필요한가: `pmis` 스키마의 테이블 19개 중 13개는 레포에 DDL 이 없다 —
대시보드에서 수동으로 만들어져 마이그레이션 파일에 기록이 남지 않았다.
팀 프로젝트로 옮기려면 실제 상태를 정확히 재현해야 하므로, 카탈로그를
직접 읽어 DDL 을 재구성한다. pg_dump 가 없는 환경에서도 동작한다.

접속은 Supabase Management API 를 쓴다(대시보드 SQL Editor 와 같은 경로).
`SUPABASE_ACCESS_TOKEN` (sbp_… Personal Access Token) 이 필요하다.

사용법:
    cd backend
    # 현재 상태 그대로 기록
    python scripts/dump_schema.py --project <ref> --schema pmis -o ../db/schema.sql

    # 팀 프로젝트용 — 스키마 이름 변경 + 미사용 테이블 제외
    python scripts/dump_schema.py --project <ref> --schema pmis \
        --rename-to site_info \
        --exclude site_media,site_milestone,site_personnel,site_spec,site_visit,progress_snapshot \
        -o ../db/migrations/000_init_site_info.sql

주의: 출력물은 초안이다. 커밋 전에 반드시 눈으로 확인할 것 — 특히 권한
(GRANT) 과 RLS 정책은 옮길 환경에 맞게 손봐야 한다.
"""
import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

API = "https://api.supabase.com/v1"


def run_sql(project: str, token: str, sql: str) -> list[dict]:
    """Management API 로 SQL 을 실행하고 행 목록을 반환한다."""
    r = httpx.post(
        f"{API}/projects/{project}/database/query",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=120,
    )
    if r.status_code >= 400:
        raise SystemExit(f"[SQL 실패 {r.status_code}] {r.text[:400]}\n--- 쿼리 ---\n{sql[:500]}")
    data = r.json()
    return data if isinstance(data, list) else []


# ── 카탈로그 조회 쿼리 ────────────────────────────────────────
# 모두 읽기 전용. %(schema)s 자리에 스키마 이름이 들어간다.

Q_TABLES = """
select c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = '{schema}' and c.relkind = 'r'
 order by c.relname
"""

Q_COLUMNS = """
select a.attrelid::regclass::text        as tbl,
       a.attname                          as name,
       format_type(a.atttypid, a.atttypmod) as type,
       a.attnotnull                       as notnull,
       pg_get_expr(d.adbin, d.adrelid)    as default_expr,
       a.attidentity                      as identity,
       a.attnum                           as pos
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where n.nspname = '{schema}' and c.relkind = 'r'
   and a.attnum > 0 and not a.attisdropped
 order by a.attrelid::regclass::text, a.attnum
"""

Q_CONSTRAINTS = """
select con.conrelid::regclass::text as tbl,
       con.conname                   as name,
       con.contype                   as type,
       pg_get_constraintdef(con.oid) as def
  from pg_constraint con
  join pg_namespace n on n.oid = con.connamespace
 where n.nspname = '{schema}'
 order by con.conrelid::regclass::text,
          case con.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end,
          con.conname
"""

Q_INDEXES = """
select tablename as tbl, indexname as name, indexdef as def
  from pg_indexes
 where schemaname = '{schema}'
 order by tablename, indexname
"""

Q_VIEWS = """
select c.relname as name,
       pg_get_viewdef(c.oid, true) as def,
       c.reloptions as options
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = '{schema}' and c.relkind = 'v'
 order by c.relname
"""

Q_FUNCTIONS = """
select p.proname as name, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = '{schema}'
 order by p.proname
"""

Q_TRIGGERS = """
select c.relname as tbl, t.tgname as name, pg_get_triggerdef(t.oid) as def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = '{schema}' and not t.tgisinternal
 order by c.relname, t.tgname
"""

Q_RLS = """
select c.relname as tbl, c.relrowsecurity as enabled
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = '{schema}' and c.relkind = 'r'
 order by c.relname
"""

Q_POLICIES = """
select tablename as tbl, policyname as name, cmd, roles::text as roles,
       qual, with_check
  from pg_policies
 where schemaname = '{schema}'
 order by tablename, policyname
"""

Q_GRANTS = """
select table_name as tbl, grantee, privilege_type as priv
  from information_schema.role_table_grants
 where table_schema = '{schema}'
   and grantee in ('anon','authenticated','service_role')
 order by table_name, grantee, privilege_type
"""

Q_SEQUENCES = """
select c.relname as name, s.last_value
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_sequences s on s.schemaname = n.nspname and s.sequencename = c.relname
 where n.nspname = '{schema}' and c.relkind = 'S'
 order by c.relname
"""


def bare(qualified: str) -> str:
    """'pmis.project_site' → 'project_site' (regclass 출력에서 스키마 제거)"""
    return qualified.split(".")[-1].strip('"')


_PLAIN = __import__("re").compile(r"^[a-z_][a-z0-9_]*$")


def qi(name: str) -> str:
    """식별자를 필요할 때만 큰따옴표로 감싼다.

    정책 이름에 공백이 섞인 경우가 있다("Allow full access", "Authenticated
    insert"). 그대로 내보내면 문법 오류가 난다. 함수명 current_role 처럼
    예약어인 경우도 인용이 필요하다."""
    n = (name or "").strip('"')
    if _PLAIN.match(n) and n not in {"current_role", "user", "role", "order", "table"}:
        return n
    return '"' + n.replace('"', '""') + '"'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Supabase project ref")
    ap.add_argument("--schema", default="pmis", help="뽑을 원본 스키마 (기본 pmis)")
    ap.add_argument("--rename-to", default=None, help="출력 SQL 에서 쓸 스키마 이름")
    ap.add_argument("--exclude", default="", help="제외할 테이블, 쉼표 구분")
    ap.add_argument("-o", "--out", required=True, help="출력 SQL 경로")
    args = ap.parse_args()

    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("SUPABASE_ACCESS_TOKEN 이 없습니다. backend/.env 에 sbp_… 토큰을 넣어주세요.",
              file=sys.stderr)
        return 2

    src = args.schema
    dst = args.rename_to or src
    skip = {t.strip() for t in args.exclude.split(",") if t.strip()}

    def q(sql: str) -> list[dict]:
        return run_sql(args.project, token, sql.format(schema=src))

    print(f"[1/9] 테이블 목록…", file=sys.stderr)
    tables = [r["name"] for r in q(Q_TABLES) if r["name"] not in skip]
    print(f"      {len(tables)}개 (제외 {len(skip)}개)", file=sys.stderr)

    print(f"[2/9] 컬럼…", file=sys.stderr);       cols = q(Q_COLUMNS)
    print(f"[3/9] 제약조건…", file=sys.stderr);   cons = q(Q_CONSTRAINTS)
    print(f"[4/9] 인덱스…", file=sys.stderr);     idxs = q(Q_INDEXES)
    print(f"[5/9] 뷰…", file=sys.stderr);         views = q(Q_VIEWS)
    print(f"[6/9] 함수…", file=sys.stderr);       funcs = q(Q_FUNCTIONS)
    print(f"[7/9] 트리거…", file=sys.stderr);     trigs = q(Q_TRIGGERS)
    print(f"[8/9] RLS·정책·권한…", file=sys.stderr)
    rls = q(Q_RLS); pols = q(Q_POLICIES); grants = q(Q_GRANTS)
    print(f"[9/9] 시퀀스…", file=sys.stderr);     seqs = q(Q_SEQUENCES)

    L: list[str] = []
    W = L.append
    W(f"-- {dst} 스키마 DDL — {args.project} 의 {src} 에서 실측 추출")
    W(f"-- scripts/dump_schema.py 생성물. 커밋 전 확인 필요 (특히 GRANT/RLS).")
    if skip:
        W(f"-- 제외한 테이블: {', '.join(sorted(skip))}")
    W("")
    W("BEGIN;")
    W("")
    W(f"-- 스키마는 이미 존재해야 한다. CREATE SCHEMA 를 일부러 넣지 않는다 —")
    W(f"-- 팀 공용 프로젝트에서는 스키마 생성·변경을 우리가 하지 않는 것이 원칙이다.")
    W(f"-- (없으면 아래 문장들이 실패하므로 잘못된 대상에 적용되는 사고를 막아준다)")
    W("")

    # ── 시퀀스 ──
    # SERIAL 컬럼의 기본값은 nextval('<schema>.<seq>') 형태다. 시퀀스를 먼저
    # 만들지 않으면 테이블 생성이 실패한다. 포함 대상 테이블이 실제로 쓰는
    # 것만 만든다(제외 테이블의 시퀀스는 따라오지 않게).
    import re as _re
    seq_owner: dict[str, tuple[str, str]] = {}
    for c in cols:
        t = bare(c["tbl"])
        if t not in tables:
            continue
        m = _re.search(r"nextval\('(?:[^.']+\.)?([^']+?)'", c.get("default_expr") or "")
        if m:
            seq_owner[m.group(1).strip('"')] = (t, c["name"])
    if seq_owner:
        W("-- ═══ 시퀀스 ═══")
        for s in sorted(seq_owner):
            W(f"CREATE SEQUENCE IF NOT EXISTS {dst}.{s};")
        W("")

    # ── 테이블 ──
    W("-- ═══ 테이블 ═══")
    for t in tables:
        tcols = [c for c in cols if bare(c["tbl"]) == t]
        W("")
        W(f"CREATE TABLE IF NOT EXISTS {dst}.{t} (")
        lines = []
        for c in tcols:
            piece = f"  {c['name']} {c['type']}"
            if c.get("identity") in ("a", "d"):
                always = "ALWAYS" if c["identity"] == "a" else "BY DEFAULT"
                piece += f" GENERATED {always} AS IDENTITY"
            elif c.get("default_expr"):
                # nextval(...) 은 시퀀스 이름에 원본 스키마가 박혀 있으므로 치환
                piece += f" DEFAULT {c['default_expr'].replace(f'{src}.', f'{dst}.')}"
            if c["notnull"]:
                piece += " NOT NULL"
            lines.append(piece)
        # PK / UNIQUE / CHECK 는 테이블 안에, FK 는 뒤에서 ALTER 로 (순서 의존 제거)
        for k in [c for c in cons if bare(c["tbl"]) == t and c["type"] in ("p", "u", "c")]:
            lines.append(f"  CONSTRAINT {qi(k['name'])} {k['def']}")
        W(",\n".join(lines))
        W(");")

    # 시퀀스를 컬럼에 귀속시켜 테이블 DROP 시 함께 정리되게 한다.
    if seq_owner:
        W("")
        W("-- 시퀀스 소유권 (테이블과 생명주기를 묶는다)")
        for s, (t, col) in sorted(seq_owner.items()):
            W(f"ALTER SEQUENCE {dst}.{s} OWNED BY {dst}.{t}.{col};")

    # ── 외래키 ──
    fks = [c for c in cons if c["type"] == "f" and bare(c["tbl"]) in tables]
    if fks:
        W("")
        W("-- ═══ 외래키 (테이블 생성 순서에 의존하지 않도록 분리) ═══")
        for k in fks:
            t = bare(k["tbl"])
            definition = k["def"].replace(f"REFERENCES {src}.", f"REFERENCES {dst}.")
            # 제외된 테이블을 참조하는 FK 는 버린다
            if any(f"REFERENCES {dst}.{s}" in definition or f"REFERENCES {s}" in definition
                   for s in skip):
                W(f"-- 건너뜀 (제외 테이블 참조): {t}.{k['name']}")
                continue
            W(f"ALTER TABLE {dst}.{t} ADD CONSTRAINT {qi(k['name'])} {definition};")

    # ── 인덱스 (제약조건이 자동 생성한 것 제외) ──
    con_names = {c["name"] for c in cons}
    own_idx = [i for i in idxs if i["tbl"] in tables and i["name"] not in con_names]
    if own_idx:
        W("")
        W("-- ═══ 인덱스 ═══")
        for i in own_idx:
            W(i["def"].replace(f" {src}.", f" {dst}.").replace(f"ON {src}.", f"ON {dst}.") + ";")

    # ── 함수 (뷰·트리거가 참조할 수 있으므로 먼저) ──
    if funcs:
        W("")
        W("-- ═══ 함수 ═══")
        for f in funcs:
            body = f["def"].replace(f"{src}.", f"{dst}.")
            # SECURITY DEFINER 함수의 `SET search_path TO 'pmis', 'public'` 은
            # 스키마 이름이 따옴표 안에 있어 위 치환에 걸리지 않는다. 이걸
            # 놓치면 함수가 없는 스키마를 찾아 RLS 정책이 통째로 실패한다.
            body = body.replace(f"'{src}'", f"'{dst}'")
            W("")
            W(body.rstrip() + ";")

    # ── 뷰 ──
    if views:
        W("")
        W("-- ═══ 뷰 ═══")
        for v in views:
            W("")
            W(f"CREATE OR REPLACE VIEW {dst}.{v['name']} AS")
            W(v["def"].replace(f"{src}.", f"{dst}.").rstrip().rstrip(";") + ";")
            if v.get("options") and any("security_invoker" in str(o) for o in (v["options"] or [])):
                W(f"ALTER VIEW {dst}.{v['name']} SET (security_invoker = true);")

    # ── 트리거 ──
    if trigs:
        W("")
        W("-- ═══ 트리거 ═══")
        for t in trigs:
            if t["tbl"] not in tables:
                continue
            W(t["def"].replace(f"{src}.", f"{dst}.") + ";")

    # ── RLS + 정책 ──
    W("")
    W("-- ═══ RLS ═══")
    for r in rls:
        if r["tbl"] in tables and r["enabled"]:
            W(f"ALTER TABLE {dst}.{r['tbl']} ENABLE ROW LEVEL SECURITY;")
    for p in pols:
        if p["tbl"] not in tables:
            continue
        W("")
        roles = (p.get("roles") or "{}").strip("{}")
        W(f"DROP POLICY IF EXISTS {qi(p['name'])} ON {dst}.{p['tbl']};")
        stmt = f"CREATE POLICY {qi(p['name'])} ON {dst}.{p['tbl']} FOR {p['cmd']}"
        if roles:
            stmt += f" TO {roles}"
        if p.get("qual"):
            stmt += f"\n  USING ({p['qual'].replace(f'{src}.', f'{dst}.')})"
        if p.get("with_check"):
            stmt += f"\n  WITH CHECK ({p['with_check'].replace(f'{src}.', f'{dst}.')})"
        W(stmt + ";")

    # ── 권한 (현재 상태를 주석으로만. 팀 환경에 맞게 직접 결정할 것) ──
    W("")
    W("-- ═══ 권한 ═══")
    W("-- anon 에는 아무 권한도 주지 않는다. 팀 공용 프로젝트의 anon 키는 다른")
    W("-- 서비스와 공유되는 공개 키이고, 실제로 그쪽 portal 스키마도 anon 에")
    W("-- grant 자체를 주지 않는다(401 로 막힘). 원본 프로젝트는 anon 에")
    W("-- INSERT/UPDATE/DELETE/TRUNCATE 까지 열려 있어 RLS 가 유일한 방어선이었다.")
    W("")
    W(f"GRANT USAGE ON SCHEMA {dst} TO authenticated, service_role;")
    W("")
    W("-- authenticated: 읽기만. 브라우저에서 직접 조회하는 참조 테이블·뷰가 있고")
    W("-- 행 단위 접근은 아래 RLS 정책이 거른다. 쓰기는 전부 백엔드를 거친다.")
    W(f"GRANT SELECT ON ALL TABLES IN SCHEMA {dst} TO authenticated;")
    W("")
    W("-- service_role: 백엔드가 쓰는 롤. RLS 를 우회하지만 테이블 권한은 별도로")
    W("-- 필요하고, SERIAL 컬럼 INSERT 를 위해 시퀀스 권한도 있어야 한다.")
    W(f"GRANT ALL ON ALL TABLES IN SCHEMA {dst} TO service_role;")
    W(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {dst} TO service_role;")
    W("")
    W("-- 원본 프로젝트의 현재 권한 (참고용 — 위 정책과 일부러 다르다)")
    for g in grants:
        if g["tbl"] in tables:
            W(f"--   {g['tbl']}: {g['grantee']} → {g['priv']}")

    kept_seqs = [s for s in seqs if s["name"] in seq_owner]
    if kept_seqs:
        W("")
        W("-- ═══ 시퀀스 현재값 (데이터 이관 후 setval 필요) ═══")
        for s in kept_seqs:
            W(f"--   {s['name']}: last_value={s.get('last_value')}")

    W("")
    W("COMMIT;")
    W("")

    out = Path(args.out)
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"\n→ {out} ({len('\n'.join(L))} bytes)", file=sys.stderr)
    print(f"  테이블 {len(tables)} / 뷰 {len(views)} / 함수 {len(funcs)} / "
          f"인덱스 {len(own_idx)} / 정책 {len(pols)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
