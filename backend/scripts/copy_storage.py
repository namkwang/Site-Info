"""스토리지 버킷과 객체를 프로젝트 간 복사 (개인 → 팀).

버킷은 프로젝트 전역 자원이라 스키마처럼 따라오지 않는다. 없으면 만들고,
객체를 하나씩 내려받아 올린다. 61개 수준이라 단순 반복으로 충분하다.

DB에 저장된 photo_url 은 개인 프로젝트 도메인이 박힌 절대 URL 이므로,
--rewrite-urls 로 호스트를 대상 프로젝트로 바꿔준다. (근본적으로는 경로만
저장하는 게 맞지만, 그건 별도 작업으로 둔다)

사용법:
    cd backend
    python scripts/copy_storage.py --dry-run
    python scripts/copy_storage.py
    python scripts/copy_storage.py --rewrite-urls   # photo_url 호스트 교체
"""
import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BUCKETS = ["org-photos", "site-images"]


def h(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def list_objects(url: str, key: str, bucket: str) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        r = httpx.post(f"{url}/storage/v1/object/list/{bucket}", headers=h(key),
                       json={"limit": 100, "offset": offset, "prefix": ""}, timeout=60)
        r.raise_for_status()
        batch = [o for o in r.json() if o.get("id")]  # 폴더 엔트리 제외
        out.extend(batch)
        if len(batch) < 100:
            return out
        offset += 100


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--rewrite-urls", action="store_true",
                    help="site_org_member.photo_url 의 호스트를 대상 프로젝트로 교체")
    args = ap.parse_args()

    src_url, src_key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    dst_url = os.environ["PROD_SUPABASE_URL"]
    dst_key = os.environ["PROD_SUPABASE_SERVICE_ROLE_KEY"]
    dst_schema = os.environ.get("PROD_DB_SCHEMA", "site_info")

    print(f"원본 {src_url.split('//')[1].split('.')[0]} → 대상 {dst_url.split('//')[1].split('.')[0]}\n")

    existing = {b["name"] for b in httpx.get(f"{dst_url}/storage/v1/bucket",
                                             headers=h(dst_key), timeout=30).json()}
    copied = 0
    for bucket in BUCKETS:
        objs = list_objects(src_url, src_key, bucket)
        src_meta = next((b for b in httpx.get(f"{src_url}/storage/v1/bucket",
                                              headers=h(src_key), timeout=30).json()
                         if b["name"] == bucket), {})
        print(f"[{bucket}] 객체 {len(objs)}개, 원본 public={src_meta.get('public')}")

        if bucket not in existing:
            print(f"    버킷 생성 (public={src_meta.get('public', True)})")
            if not args.dry_run:
                r = httpx.post(f"{dst_url}/storage/v1/bucket", headers=h(dst_key),
                               json={"name": bucket, "id": bucket,
                                     "public": bool(src_meta.get("public", True))},
                               timeout=60)
                if r.status_code >= 400:
                    print(f"    버킷 생성 실패: {r.status_code} {r.text[:200]}", file=sys.stderr)
                    return 1
        else:
            print("    버킷 이미 존재 — 생성 건너뜀")

        for o in objs:
            name = o["name"]
            if args.dry_run:
                copied += 1
                continue
            g = httpx.get(f"{src_url}/storage/v1/object/{bucket}/{name}",
                          headers=h(src_key), timeout=120)
            if g.status_code >= 400:
                print(f"    {name} 다운로드 실패 {g.status_code}", file=sys.stderr)
                continue
            ct = g.headers.get("content-type", "application/octet-stream")
            u = httpx.post(f"{dst_url}/storage/v1/object/{bucket}/{name}",
                           headers={**h(dst_key), "Content-Type": ct,
                                    "x-upsert": "true"},
                           content=g.content, timeout=180)
            if u.status_code >= 400:
                print(f"    {name} 업로드 실패 {u.status_code} {u.text[:200]}", file=sys.stderr)
                continue
            copied += 1
        print(f"    복사 {copied}개 누적")

    if args.dry_run:
        print(f"\n(dry-run) 옮길 객체 {copied}개")
        return 0

    # 검증
    print("\n검증:")
    ok = True
    for bucket in BUCKETS:
        s = len(list_objects(src_url, src_key, bucket))
        d = len(list_objects(dst_url, dst_key, bucket))
        print(f"  {bucket:14} 원본 {s:>3} / 대상 {d:>3}  {'OK' if s == d else '불일치'}")
        ok = ok and s == d

    if args.rewrite_urls:
        # photo_url 에 박힌 개인 프로젝트 호스트를 대상 호스트로 바꾼다.
        src_host = src_url.rstrip("/")
        dst_host = dst_url.rstrip("/")
        hh = {**h(dst_key), "Accept-Profile": dst_schema, "Content-Profile": dst_schema,
              "Content-Type": "application/json"}
        r = httpx.get(f"{dst_url}/rest/v1/site_org_member",
                      params={"select": "id,photo_url", "photo_url": "not.is.null"},
                      headers=hh, timeout=60)
        rows = r.json() if r.status_code == 200 else []
        changed = 0
        for row in rows:
            old = row.get("photo_url") or ""
            if src_host not in old:
                continue
            new = old.replace(src_host, dst_host)
            p = httpx.patch(f"{dst_url}/rest/v1/site_org_member",
                            params={"id": f"eq.{row['id']}"},
                            headers={**hh, "Prefer": "return=minimal"},
                            json={"photo_url": new}, timeout=60)
            if p.status_code < 400:
                changed += 1
        print(f"\nphoto_url 재작성: {len(rows)}건 중 {changed}건 교체")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
