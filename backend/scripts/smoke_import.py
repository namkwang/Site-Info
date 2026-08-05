"""CI smoke test — verify the FastAPI app imports cleanly and registers
every expected route.

Used by `.github/workflows/ci.yml`. Failing here means a circular import,
missing dependency, or a router didn't get wired up in main.py.

Run from the backend/ directory:
    python scripts/smoke_import.py
"""
import sys
from pathlib import Path

# This script lives in backend/scripts/; main.py lives one level up. Make
# the parent directory importable regardless of CWD.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main

# app.routes 를 직접 훑지 않는 이유: 이 FastAPI 버전은 include_router 로 붙인
# 라우터를 `_IncludedRouter` 로 지연 등록해서, 그 객체에는 `.path` 가 없다
# (예전 코드가 r.path 를 읽어 AttributeError 로 CI 가 항상 실패했다).
# OpenAPI 스키마는 라우터를 해석한 결과라 실제 노출 경로를 정확히 보여준다.
paths = main.app.openapi()["paths"]
api_paths = sorted(p for p in paths if p.startswith("/api"))
print(f"OK: {len(api_paths)} api paths registered")

if not api_paths:
    raise SystemExit("FAIL: no /api paths registered — main.py may be missing app.include_router calls")

# 라우터가 통째로 빠지는 사고를 잡는다. main.py 에서 include_router 를 지우면
# 문법 오류 없이 그 도메인의 엔드포인트만 조용히 사라진다.
REQUIRED = ["/api/me", "/api/auth/login", "/api/sites", "/api/statistics/summary",
            "/api/users", "/api/lookups", "/api/v1/external/sso-ticket"]
missing = [p for p in REQUIRED if p not in paths]
if missing:
    raise SystemExit(f"FAIL: 필수 경로 누락 {missing}")
print(f"OK: 필수 경로 {len(REQUIRED)}개 확인")
