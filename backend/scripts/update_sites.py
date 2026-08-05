"""
건축현장 데이터 업데이트 스크립트 ('26년3월 현황표 기준)
- contract_amount (공사금액, 억원)
- site_manager, manager_position (현장소장)
- start_date (착공시기)
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

# 이미지 데이터 -> DB site_id 매핑
# site_id는 supabase_sites.json 기준
updates = [
    # 남양주왕숙
    {"id": 82, "name": "남양주왕숙 S-3BL",       "contract_amount": 3297, "site_manager": None,     "manager_position": None,   "start_date": "2026-12-01"},
    {"id": 83, "name": "남양주왕숙 S-13BL",      "contract_amount": 3333, "site_manager": None,     "manager_position": None,   "start_date": "2026-12-01"},
    # 부천대장/역곡
    {"id": 39, "name": "부천대장 A1",             "contract_amount": 1458, "site_manager": "김유찬", "manager_position": "이사", "start_date": "2026-03-01"},
    {"id": 40, "name": "부천대장 A2",             "contract_amount": 1465, "site_manager": "임성훈", "manager_position": "이사", "start_date": "2026-03-01"},
    {"id": 41, "name": "부천대장 A12",            "contract_amount": 1652, "site_manager": "김원용", "manager_position": "이사", "start_date": "2026-03-01"},
    {"id": 37, "name": "부천역곡 A2BL",           "contract_amount": 3775, "site_manager": "조윤연", "manager_position": "이사", "start_date": "2026-03-01"},
    {"id": 79, "name": "부천대장 A9BL",           "contract_amount": 1486, "site_manager": "이민성", "manager_position": "부장", "start_date": "2026-06-01"},
    # 인천계양
    {"id": 80, "name": "인천계양 A16BL",          "contract_amount": 1161, "site_manager": "고영준", "manager_position": "부장", "start_date": "2026-06-01"},
    {"id": 81, "name": "인천계양 A18BL",          "contract_amount": 1429, "site_manager": "정오기", "manager_position": "이사", "start_date": "2026-06-01"},
    # 성남/광주/수원
    {"id": 77, "name": "성남금토 A-4BL",          "contract_amount": 2120, "site_manager": "박시영", "manager_position": "상무", "start_date": None},  # 공사중
    {"id": 75, "name": "광주역세권청년혁신타운",   "contract_amount": 1202, "site_manager": "김성훈", "manager_position": "이사", "start_date": None},  # 공사중
    # 구리/다산/의정부
    {"id": 78, "name": "구리갈매역세권",           "contract_amount": 3070, "site_manager": "정현석", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 76, "name": "다산지금A3BL",            "contract_amount": 928,  "site_manager": "김성원", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 38, "name": "의정부 우정A2",           "contract_amount": 1062, "site_manager": "황호린", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 74, "name": "의정부 우정",             "contract_amount": 914,  "site_manager": "정덕기", "manager_position": "부장", "start_date": "2026-06-01"},  # 의정부우정S1
    # 권역외
    {"id": 73, "name": "마곡지식산업센터",         "contract_amount": 998,  "site_manager": "박종환", "manager_position": "상무", "start_date": None},  # 공사중
    {"id": 72, "name": "김해진례",                "contract_amount": 832,  "site_manager": "전왕렬", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 71, "name": "행복5-1",                 "contract_amount": 962,  "site_manager": "최인호", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 70, "name": "강원대BTL 삼척캠퍼스",     "contract_amount": 302,  "site_manager": "이상현", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 35, "name": "포천간부숙소",             "contract_amount": 438,  "site_manager": "이동원", "manager_position": "부장", "start_date": None},  # 공사중
    {"id": 36, "name": "육군 장성 교육시설",       "contract_amount": 469,  "site_manager": "신현배", "manager_position": "부장", "start_date": None},  # 공사중
]

# 매칭 안 되는 현장 목록 (DB에 없거나 이름이 다른 현장)
unmatched = [
    "남양주왕숙S9 (3,962억) - DB에 S-9BL 없음",
    "산곡재원 (821억) - DB에 없음",
    "부천로얄 (588억) - DB에 없음",
    "부평관사 (748억) - DB에 없음",
    "영진시장 (668억) - DB에 없음",
    "성남금광 (2,047억) - DB에 없음",
    "가락현대 (471억) - DB에 없음",
    "수원연무 (816억) - DB에 수원연무219/220 두 개 있어서 구분 불가",
    "공릉대명 (425억) - DB에 공릉하우스토리만 있음 (이름 다름)",
    "의정부법조타운S1 (1,010억) - DB에 없음",
    "가능2차 (425억) - DB에 없음",
    "고대안암병원 (1,010억) - DB에 없음",
]

def run_updates():
    success = 0
    failed = 0

    for site in updates:
        update_data = {"contract_amount": site["contract_amount"]}

        # site_manager & manager_position
        if site["site_manager"] is not None:
            update_data["site_manager"] = site["site_manager"]
            update_data["manager_position"] = site["manager_position"]

        # start_date (공사중인 현장은 이미 start_date 있을 수 있으므로 건너뜀)
        if site["start_date"] is not None:
            update_data["start_date"] = site["start_date"]

        try:
            response = supabase.schema(DB_SCHEMA).from_("project_site") \
                .update(update_data) \
                .eq("id", site["id"]) \
                .execute()

            if response.data:
                print(f"  ✓ [{site['id']}] {site['name']} - 업데이트 완료")
                success += 1
            else:
                print(f"  ✗ [{site['id']}] {site['name']} - 데이터 없음 (id 불일치?)")
                failed += 1
        except Exception as e:
            print(f"  ✗ [{site['id']}] {site['name']} - 오류: {e}")
            failed += 1

    print(f"\n=== 결과 ===")
    print(f"성공: {success}건")
    print(f"실패: {failed}건")
    print(f"\n=== 매칭 안 되는 현장 ({len(unmatched)}건) ===")
    for u in unmatched:
        print(f"  - {u}")


if __name__ == "__main__":
    run_updates()
