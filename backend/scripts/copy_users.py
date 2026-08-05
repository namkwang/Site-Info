"""사용자 이관 — 우리 스키마(user_profile)가 주체, auth 는 자격증명만 따라온다.

사용자 관리는 site_info.user_profile 이 담당한다(이름·사번·법인·역할·승인상태).
auth 는 이메일/비밀번호 보관과 JWT 발급만 한다. 그래서 이관도 프로필을 기준으로
하고, auth 계정은 **프로필의 id 를 그대로 받아** 만든다 — id 가 어긋나면
RLS(`id = auth.uid()`)와 deps.py 의 프로필 조회가 전부 깨진다.

실증한 것 (2026-08-05):
  - Auth Admin API 는 `id` 지정을 허용한다 → 원래 UUID 보존 가능
  - `password_hash` 로 bcrypt 해시를 넘길 수 있다 → 사용자는 기존 비밀번호로
    그대로 로그인한다. 재설정 안내가 필요 없다.

단, 팀 프로젝트의 auth 는 조직 전체가 공유한다. 우리 사용자 중 일부는 이미
다른 서비스를 쓰며 계정을 갖고 있고(실측 22명 중 4명), 그 계정의 UUID 는 우리
개인 프로젝트의 UUID 와 다르다. 이메일이 선점돼 있어 새로 만들 수도 없다.
**한 사람은 팀 프로젝트에서 계정 하나**가 맞으므로, 그런 사용자는 기존 계정의
id 를 정답으로 삼고 프로필 id 를 그쪽에 맞춘다(remap). 비밀번호는 건드리지
않는다 — 이미 쓰고 있는 계정이다.

순서가 중요하다. auth 계정을 먼저 확보하고 프로필을 넣는다 — 프로필만 있고
계정이 없으면 로그인이 불가능하고, 반대는 pending 취급이라 안전하다.
같은 이유로 재실행에 안전하다: 이미 있는 계정은 만들지 않고 넘어간다.

사용법:
    cd backend
    python scripts/copy_users.py --dry-run
    python scripts/copy_users.py
"""
import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MGMT = "https://api.supabase.com/v1"

# 프로필에서 그대로 옮기는 컬럼. 감사 컬럼(created_at/updated_at)도 보존한다.
PROFILE_COLS = [
    "id", "email", "full_name", "employee_number", "corporation_id",
    "role", "status", "requested_at", "approved_at", "approved_by",
    "reject_reason", "created_at", "updated_at",
]


def sql(project: str, token: str, query: str) -> list[dict]:
    r = httpx.post(f"{MGMT}/projects/{project}/database/query",
                   headers={"Authorization": f"Bearer {token}",
                            "Content-Type": "application/json"},
                   json={"query": query}, timeout=180)
    if r.status_code >= 400:
        raise SystemExit(f"[SQL 실패 {r.status_code}] {r.text[:400]}")
    d = r.json()
    return d if isinstance(d, list) else []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--src-project", default="mpoufkwszfihkufkundx")
    ap.add_argument("--dst-project", default="yjohztoqabbttfcuzmsp")
    args = ap.parse_args()

    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("SUPABASE_ACCESS_TOKEN 이 필요합니다 (비밀번호 해시 조회에 사용).",
              file=sys.stderr)
        return 2

    dst_url = os.environ["PROD_SUPABASE_URL"]
    dst_key = os.environ["PROD_SUPABASE_SERVICE_ROLE_KEY"]
    src_schema = os.environ.get("DB_SCHEMA", "pmis")
    dst_schema = os.environ.get("PROD_DB_SCHEMA", "site_info")

    auth_h = {"apikey": dst_key, "Authorization": f"Bearer {dst_key}",
              "Content-Type": "application/json"}
    db_h = {**auth_h, "Accept-Profile": dst_schema, "Content-Profile": dst_schema}

    # ── 원본: 프로필 + 대응하는 auth 자격증명을 한 번에 읽는다 ──
    cols = ", ".join(f"p.{c}" for c in PROFILE_COLS)
    rows = sql(args.src_project, token, f"""
        select {cols},
               u.encrypted_password,
               u.email_confirmed_at,
               u.phone as auth_phone
          from {src_schema}.user_profile p
          join auth.users u on u.id = p.id
         order by p.created_at
    """)
    orphans = sql(args.src_project, token, f"""
        select count(*) as n
          from {src_schema}.user_profile p
          left join auth.users u on u.id = p.id
         where u.id is null
    """)
    n_orphan = (orphans or [{}])[0].get("n", 0)

    print(f"원본 프로필 {len(rows)}건 (auth 계정 없는 프로필 {n_orphan}건은 제외)")
    from collections import Counter
    print("  role:", dict(Counter(r["role"] for r in rows)),
          " status:", dict(Counter(r["status"] for r in rows)))
    no_pw = [r for r in rows if not r.get("encrypted_password")]
    if no_pw:
        print(f"  비밀번호 해시 없는 계정 {len(no_pw)}건 — 임시 비밀번호로 생성되며 재설정 필요")

    # ── 대상이 비어 있는지 확인 ──
    ex = httpx.get(f"{dst_url}/rest/v1/user_profile", params={"select": "id,email"},
                   headers=db_h, timeout=60).json()
    if ex:
        print(f"\n대상에 이미 프로필 {len(ex)}건이 있습니다. 중복 방지를 위해 중단합니다.",
              file=sys.stderr)
        return 1

    if args.dry_run:
        print("\n(dry-run) 옮길 목록:")
        for r in rows:
            print(f"  {r['email']:38} {r['role']:6} {r['status']:9} id={r['id'][:8]}…")
        return 0

    # ── ① 대상 auth 계정 확보. 이미 있으면 그 id 가 정답이다(remap) ──
    emails = ", ".join("'" + r["email"].replace("'", "''") + "'" for r in rows)
    existing = {e["email"]: e["id"] for e in sql(args.dst_project, token, f"""
        select id, email from auth.users where email in ({emails})
    """)}

    remap: dict[str, str] = {}     # 원본 id → 대상 id
    created, reused, failed = 0, 0, []
    for r in rows:
        if r["email"] in existing:
            remap[r["id"]] = existing[r["email"]]
            reused += 1
            continue
        body = {
            "id": r["id"],
            "email": r["email"],
            # 이메일 확인은 원본 상태를 따른다. 우리 승인제(status)가 실제 게이트다.
            "email_confirm": bool(r.get("email_confirmed_at")),
        }
        if r.get("encrypted_password"):
            body["password_hash"] = r["encrypted_password"]
        else:
            body["password"] = f"Temp!{r['id'][:12]}"
        resp = httpx.post(f"{dst_url}/auth/v1/admin/users", headers=auth_h,
                          json=body, timeout=120)
        if resp.status_code >= 400:
            failed.append((r["email"], resp.status_code, resp.text[:200]))
            continue
        got = resp.json().get("id")
        if got != r["id"]:
            failed.append((r["email"], "id 불일치", f"{got} != {r['id']}"))
            continue
        remap[r["id"]] = got
        created += 1
    print(f"① auth 계정: 신규 {created}건 / 기존 재사용 {reused}건 / 실패 {len(failed)}건")
    for e in failed:
        print(f"   실패: {e}", file=sys.stderr)
    if failed:
        print("실패가 있어 프로필 삽입을 중단합니다.", file=sys.stderr)
        return 1

    changed = [(s, d) for s, d in remap.items() if s != d]
    if changed:
        print(f"   id 가 바뀐 사용자 {len(changed)}명 — 팀에 이미 계정이 있어 그쪽 id 를 따른다")

    # ── ② 프로필 (우리 스키마 = 사용자 관리의 주체) ──
    payload = []
    for r in rows:
        p = {c: r[c] for c in PROFILE_COLS}
        p["id"] = remap[r["id"]]
        # 승인자도 같은 규칙으로 옮긴다. 이번에 안 넘어온 사람을 가리키면 비운다
        # (FK 는 없지만 존재하지 않는 UUID 를 남기면 의미가 깨진다).
        if p.get("approved_by"):
            p["approved_by"] = remap.get(p["approved_by"])
        payload.append(p)
    ins = httpx.post(f"{dst_url}/rest/v1/user_profile", headers={**db_h, "Prefer": "return=minimal"},
                     json=payload, timeout=180)
    if ins.status_code >= 400:
        print(f"② 프로필 삽입 실패 {ins.status_code}: {ins.text[:400]}", file=sys.stderr)
        return 1
    print(f"② {dst_schema}.user_profile: {len(payload)}건")

    # ── ③ 검증 ──
    after = httpx.get(f"{dst_url}/rest/v1/user_profile",
                      params={"select": "id,email,role,status"}, headers=db_h, timeout=60).json()
    # 이메일 기준으로 대조한다 — id 는 remap 됐을 수 있다.
    src_map = {r["email"]: (r["role"], r["status"]) for r in rows}
    mismatch = [a for a in after if src_map.get(a["email"]) != (a["role"], a["status"])]
    print(f"③ 검증: 대상 {len(after)}건 / 원본 {len(rows)}건, 불일치 {len(mismatch)}건")
    print("  role:", dict(Counter(a["role"] for a in after)),
          " status:", dict(Counter(a["status"] for a in after)))

    # 프로필 id 가 실제 auth 계정과 1:1 로 맞는지 — 어긋나면 로그인해도 pending 취급된다
    linked = sql(args.dst_project, token, f"""
        select count(*) as n
          from {dst_schema}.user_profile p
          join auth.users u on u.id = p.id
    """)
    n_linked = (linked or [{}])[0].get("n", 0)
    print(f"④ auth 계정과 연결된 프로필: {n_linked}/{len(after)}건"
          f" {'✅' if n_linked == len(after) else '❌ 연결 안 된 프로필은 로그인해도 접근 불가'}")

    ok = len(after) == len(rows) and not mismatch and n_linked == len(after)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
