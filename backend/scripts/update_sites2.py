"""
2차 업데이트: 공릉대명, 수원연무 업데이트 + 신규 현장 추가
"""
from supabase import create_client

from dotenv import load_dotenv
import os

# 우리 테이블이 사는 스키마. 팀 공용 프로젝트에서는 env 로 site_info 를 준다.
DB_SCHEMA = os.environ.get("DB_SCHEMA", "pmis")

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def check_project_site_columns():
    """project_site 테이블의 컬럼 확인용 - 기존 데이터 한 건 조회"""
    resp = supabase.schema(DB_SCHEMA).from_("project_site").select("*").eq("id", 34).execute()
    if resp.data:
        print("=== project_site 컬럼 목록 ===")
        for k, v in resp.data[0].items():
            print(f"  {k}: {v}")
    return resp.data[0] if resp.data else None


def update_existing():
    """1. 공릉대명(=공릉하우스토리, id 34) 업데이트"""
    print("\n=== 기존 현장 업데이트 ===")

    # 공릉대명 = 공릉하우스토리 (id 34, 남광토건)
    resp = supabase.schema(DB_SCHEMA).from_("project_site") \
        .update({
            "contract_amount": 425,
            "site_manager": "백원득",
            "manager_position": "부장",
        }) \
        .eq("id", 34).execute()
    print(f"  공릉하우스토리(id 34): {'OK' if resp.data else 'FAIL'}")


def merge_suwon():
    """2. 수원연무219(84) + 수원연무220(85) -> 수원연무로 합침
    - 84번을 '수원연무'로 이름 변경 + 데이터 업데이트
    - 85번 삭제
    """
    print("\n=== 수원연무 합치기 ===")

    # 84번 업데이트
    resp = supabase.schema(DB_SCHEMA).from_("project_site") \
        .update({
            "name": "수원연무",
            "contract_amount": 816,
            "start_date": "2026-12-01",
        }) \
        .eq("id", 84).execute()
    print(f"  수원연무219(id 84) -> 수원연무: {'OK' if resp.data else 'FAIL'}")

    # 85번 삭제
    resp = supabase.schema(DB_SCHEMA).from_("project_site") \
        .delete() \
        .eq("id", 85).execute()
    print(f"  수원연무220(id 85) 삭제: {'OK' if resp.data else 'FAIL'}")


def insert_new_sites(sample_row):
    """3. 신규 현장 추가"""
    print("\n=== 신규 현장 추가 ===")

    # corporation_id: 남광=1, 극동=2, 금광=3
    new_sites = [
        # 남양주왕숙S9 - 남광
        {"name": "남양주왕숙 S-9BL", "corporation_id": 2, "division": "건축",
         "contract_amount": 3962, "start_date": "2026-12-01",
         "site_manager": None, "manager_position": None, "status": "PRE_START"},
        # 산곡재원 - 남광
        {"name": "산곡재원", "corporation_id": 1, "division": "건축",
         "contract_amount": 821, "start_date": "2026-06-01",
         "site_manager": "홍순필", "manager_position": "부장", "status": "PRE_START"},
        # 부천로얄 - 남광
        {"name": "부천로얄", "corporation_id": 1, "division": "건축",
         "contract_amount": 588, "start_date": "2026-06-01",
         "site_manager": "곽재영", "manager_position": "부장", "status": "PRE_START"},
        # 부평관사 - 금광
        {"name": "부평관사", "corporation_id": 3, "division": "건축",
         "contract_amount": 748, "start_date": "2026-09-01",
         "site_manager": "심진호", "manager_position": "부장", "status": "PRE_START"},
        # 영진시장 - 남광
        {"name": "영진시장", "corporation_id": 1, "division": "건축",
         "contract_amount": 668, "start_date": "2026-12-01",
         "site_manager": "김영기", "manager_position": "부장", "status": "PRE_START"},
        # 성남금광 - 남광
        {"name": "성남금광", "corporation_id": 1, "division": "건축",
         "contract_amount": 2047, "start_date": "2026-12-01",
         "site_manager": None, "manager_position": None, "status": "PRE_START"},
        # 가락현대 - 남광
        {"name": "가락현대", "corporation_id": 1, "division": "건축",
         "contract_amount": 471, "start_date": "2026-12-01",
         "site_manager": None, "manager_position": None, "status": "PRE_START"},
        # 의정부법조타운S1 - 남광
        {"name": "의정부법조타운 S1", "corporation_id": 1, "division": "건축",
         "contract_amount": 1010, "start_date": "2026-04-01",
         "site_manager": "홍성일", "manager_position": "이사", "status": "PRE_START"},
        # 가능2차 - 남광
        {"name": "가능2차", "corporation_id": 1, "division": "건축",
         "contract_amount": 425, "start_date": "2026-07-01",
         "site_manager": None, "manager_position": None, "status": "PRE_START"},
        # 고대안암병원 - 극동
        {"name": "고대안암병원", "corporation_id": 2, "division": "건축",
         "contract_amount": 1010, "start_date": "2026-04-01",
         "site_manager": None, "manager_position": None, "status": "PRE_START"},
    ]

    for site in new_sites:
        try:
            resp = supabase.schema(DB_SCHEMA).from_("project_site") \
                .insert(site).execute()
            new_id = resp.data[0]["id"] if resp.data else "?"
            print(f"  + {site['name']} (id {new_id}): OK")
        except Exception as e:
            print(f"  x {site['name']}: {e}")


if __name__ == "__main__":
    sample = check_project_site_columns()
    update_existing()
    merge_suwon()
    insert_new_sites(sample)
    print("\n=== 완료 ===")
