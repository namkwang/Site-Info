# backend/scripts

운영 코드(`backend/main.py`)와 분리된 **일회성/관리용 스크립트** 모음.

대부분 `backend/.env`의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 사용하므로, 실행 시 backend 디렉토리에서 실행하거나 `dotenv` 경로가 잡히는 환경에서 실행해야 한다.

`dump_schema.py`와 `run_sql.py`는 예외로 `SUPABASE_ACCESS_TOKEN`(계정 단위 Personal Access Token)을 쓴다. service_role 키는 PostgREST용 API 토큰이라 임의 SQL·DDL을 실행할 수 없고 카탈로그 조회도 안 되기 때문이다. 토큰은 https://supabase.com/dashboard/account/tokens 에서 발행한다.

```bash
cd backend
python scripts/<script>.py [args...]
```

## 파일별 목적

### `create_admin.py` — 관리자 계정 부트스트랩 (재사용 가능)
첫 admin 계정을 생성하거나, 이미 존재하는 사용자를 admin으로 승격한다. **멱등**.

```bash
python scripts/create_admin.py <email> <password> [<full_name>]
```

신규 환경 셋업 시 매번 사용. 보존.

### `seed_default_departments.py` — 부서 백필 (실행 완료, 보존)
부서가 하나도 없는 기존 현장에 기본 5팀(공무/공사/기계·토목/품질/안전) 추가. **멱등**.

```bash
python scripts/seed_default_departments.py
```

신규 현장 추가 시 backfill이 필요해질 수 있어 보존. 신규 현장은 `main.py`의 site 생성 시 동일 기본값을 사용하는지 확인 필요.

### `update_sites.py` — 1차 데이터 마이그레이션 (2026-03 현황표)
`contract_amount`, `site_manager`, `manager_position`, `start_date` 일괄 업데이트. 하드코딩된 매핑 사용.

**일회성** — 이미 적용 완료된 마이그레이션. 향후 같은 형태의 데이터 갱신이 발생하면 새 스크립트를 작성하거나 본 파일을 복제해 사용. 참조용 보존.

### `update_sites2.py` — 2차 데이터 마이그레이션 (공릉대명/수원연무 + 신규 현장)
`update_sites.py`의 후속. **일회성**, 이미 적용 완료. 참조용 보존.

### `dump_schema.py` — 스키마 DDL 실측 추출 (재사용 가능)
DB 카탈로그를 직접 읽어 스키마 하나의 DDL(테이블·시퀀스·제약조건·인덱스·함수·뷰·트리거·RLS)을 SQL 파일로 만든다. `pg_dump`가 없는 환경에서도 동작한다.

만든 이유: `pmis` 테이블 19개 중 13개는 대시보드에서 수동 생성돼 레포에 DDL이 없었다. **스키마가 바뀌면 이 스크립트로 `db/schema.sql`을 다시 뽑아 커밋한다** — DB에만 존재하고 코드에 없는 상태를 다시 만들지 않기 위해서다.

```bash
python scripts/dump_schema.py --project <ref> --schema pmis -o ../db/schema.sql

# 팀 프로젝트용 — 스키마 이름 변경 + 미사용 테이블 제외
python scripts/dump_schema.py --project <ref> --schema pmis --rename-to site_info \
  --exclude site_media,site_milestone,site_personnel,site_spec,site_visit,progress_snapshot \
  -o ../db/migrations/000_init_site_info.sql
```

`SUPABASE_ACCESS_TOKEN`(Personal Access Token)이 필요하다 — 아래 참고.

### `run_sql.py` — SQL 파일/문자열 실행 (재사용 가능)
`apply_migration.py`의 대안. Postgres 직결(`DATABASE_URL`)이 막힌 환경에서도 마이그레이션을 적용할 수 있게 Supabase Management API를 쓴다(대시보드 SQL Editor와 같은 경로).

`--dry-run`은 `BEGIN … ROLLBACK`으로 감싸 실행 가능성만 검증하고 되돌린다. **운영 DB에 적용하기 전에는 반드시 이걸로 먼저 확인한다** — init 스크립트에서 시퀀스 누락, 함수 `search_path` 미치환, 정책 이름 인용 누락을 이 방식으로 잡았다.

```bash
python scripts/run_sql.py --project <ref> -f ../db/migrations/018_audit_columns.sql --dry-run
python scripts/run_sql.py --project <ref> -f ../db/migrations/018_audit_columns.sql
python scripts/run_sql.py --project <ref> -c "select count(*) from site_info.project_site"
```

## 운영 정책

- 새 일회성 스크립트는 이 디렉토리에 추가.
- 운영 API에서 호출되는 코드는 절대 이 디렉토리에 두지 않는다 (`backend/main.py`나 향후의 `backend/routers/`로).
- 스크립트가 의존하는 외부 데이터 파일(예: 입력 JSON)은 같은 위치에 두고 `.gitignore` 여부를 README에 명시.
