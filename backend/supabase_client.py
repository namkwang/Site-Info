"""Single Supabase client + env constants used across routers and services.

Importing this module loads the .env file (idempotent) and creates one
shared `supabase` instance with the service-role key. Every router/service
that touches the DB or storage should import `supabase` from here rather
than calling `create_client(...)` again.
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
KAKAO_REST_KEY = os.environ.get("KAKAO_REST_KEY", "")

# 우리 테이블이 사는 스키마. 팀 공용 프로젝트에서는 `site_info` 를 쓰고
# 개인 개발 프로젝트는 기존 `pmis` 를 유지하므로 env 로 뺐다. 코드에서
# 스키마 이름을 문자열로 박지 말고 반드시 db() 를 쓸 것.
DB_SCHEMA = os.environ.get("DB_SCHEMA", "pmis")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def db():
    """우리 스키마에 바인딩된 Supabase 쿼리 빌더. `supabase.schema(DB_SCHEMA)`
    의 단축형 — 스키마 이름이 한 곳에만 있게 해서 이름 변경을 env 한 줄로
    끝낼 수 있다."""
    return supabase.schema(DB_SCHEMA)

# Backend-local cache for per-site coordinates. The dashboard view
# (`v_site_dashboard`) does not return lat/lon — we read it from this JSON
# file instead so the geocoding cache survives restarts.
COORDS_FILE = Path(__file__).parent / "site_coordinates.json"
