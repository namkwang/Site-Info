"""포털 SSO — 티켓 발급·사용.

포털이 서버-투-서버로 티켓을 받아 브라우저를 /sso?ticket=… 로 보내면, 우리가
티켓을 검증해 세션을 만든다. 티켓은 60초·1회용이다.

우리가 판단해야 하는 것(명세가 각 시스템 책임으로 남긴 부분):

  1) **ROLE_CODE → 내부 role 매핑을 여기 한 곳에서만** 정의한다.
  2) **모르는 값·누락은 거부하지 않는다.** 최소 권한(viewer)으로 폴백한다 —
     포털에 새 role 이 생겨도 로그인이 깨지지 않아야 한다.
  3) **강등하지 않는다.** 포털 role 은 신규 생성·승격에만 반영하고, 이미 높은
     권한을 가진 사용자는 그대로 둔다(상위 권한 부여는 우리 관리 화면에서만).

승인 게이트에 대한 우리 정책: SSO 로 들어온 사용자는 `approved` 로 만든다.
포털이 이미 인증·인가를 마쳤고 명세의 흐름도 자동 로그인이다. 관리자 승인
절차는 자체 가입 경로에만 남는다.
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase_client import db, supabase
from services.fail_log import log_failure

TICKET_TTL_SECONDS = 60

# 포털이 보내는 ROLE_CODE 중 우리가 관리자 권한으로 인정하는 값.
# 이 목록은 포털 운영자에게 공유해야 한다(명세 4번).
ADMIN_ROLE_CODES = {"ADMIN", "GROUP_ADMIN", "SITE_INFO_ADMIN"}

# 우리 시스템의 role 은 viewer / admin 둘뿐이다(020).
DEFAULT_ROLE = "viewer"


def map_role(role_code: Optional[str]) -> str:
    """ROLE_CODE → 내부 role. 모르는 값·누락은 최소 권한으로."""
    if not role_code:
        return DEFAULT_ROLE
    return "admin" if role_code.strip().upper() in ADMIN_ROLE_CODES else DEFAULT_ROLE


def token_matches(supplied: Optional[str]) -> bool:
    """포털과 합의한 공유 토큰 확인. 문자열 비교는 상수 시간으로 한다 —
    일반 비교는 앞자리부터 틀리는 지점이 응답 시간에 드러난다."""
    expected = os.environ.get("EXTERNAL_SSO_TOKEN", "")
    if not expected or not supplied:
        return False
    return hmac.compare_digest(supplied, expected)


def _hash(ticket: str) -> str:
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def lookup_portal_user(employee_no: str) -> Optional[dict]:
    """포털 사용자 디렉터리에서 이름·부서를 찾는다 (portal.portal_users).

    포털 payload 에는 이름만 있고 부서가 없어서, 화면에 "이름 · 부서"로 보이게
    하려면 여기서 가져와야 한다. **읽기만** 한다 — 다른 스키마를 고치지 않는다.

    사번 형식이 다르다: 포털은 우리에게 법인코드가 붙은 8자리(21226064)를
    보내는데, portal_users 에는 6자리(226064)로 들어 있다. 정확히 일치하는
    값을 먼저 찾고, 없으면 앞 두 자리(법인코드)를 떼고 다시 찾는다.

    실패해도 로그인을 막지 않는다. 표시용 정보일 뿐이다."""
    candidates = [employee_no]
    if len(employee_no) > 6 and employee_no.isdigit():
        candidates.append(employee_no[2:])
    for emp in candidates:
        try:
            r = (supabase.schema("portal").from_("portal_users")
                 .select("emp_no,name,dept").eq("emp_no", emp).limit(1).execute())
        except Exception as e:
            log_failure("sso.portal_lookup", e, source_key=employee_no)
            return None
        row = (r.data or [None])[0]
        if row:
            return row
    return None


def issue_ticket(employee_no: str, role_code: Optional[str],
                 full_name: Optional[str],
                 department: Optional[str] = None) -> tuple[str, int]:
    """티켓 원문과 유효 초를 돌려준다. DB 에는 해시만 저장한다."""
    ticket = secrets.token_urlsafe(32)
    db().from_("sso_ticket").insert({
        "ticket_hash": _hash(ticket),
        "employee_no": employee_no,
        "role_code": role_code,
        "full_name": full_name,
        "department": department,
        "expires_at": (_now() + timedelta(seconds=TICKET_TTL_SECONDS)).isoformat(),
    }).execute()
    return ticket, TICKET_TTL_SECONDS


class TicketError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def redeem_ticket(ticket: str) -> dict:
    """티켓을 사용 처리하고 담긴 정보를 돌려준다.

    1회용을 보장하는 방법: `used_at IS NULL` 조건을 붙인 UPDATE 로 표시하고,
    **갱신된 행이 있는지**로 판단한다. 조회 후 갱신하면 두 요청이 같은 티켓을
    동시에 통과할 수 있다(경합)."""
    h = _hash(ticket)
    r = (db().from_("sso_ticket")
         .update({"used_at": _now().isoformat()})
         .eq("ticket_hash", h)
         .is_("used_at", "null")
         .execute())
    row = (r.data or [None])[0]
    if row is None:
        # 없는 티켓과 이미 쓴 티켓을 구분해 알려주지 않는다.
        raise TicketError("유효하지 않거나 이미 사용된 티켓입니다")

    if datetime.fromisoformat(row["expires_at"]) < _now():
        raise TicketError("티켓이 만료되었습니다. 포털에서 다시 시도해주세요")

    return row


def upsert_sso_user(employee_no: str, role_code: Optional[str],
                    full_name: Optional[str],
                    department_hint: Optional[str] = None) -> dict:
    """사번으로 프로필을 찾고, 없으면 만든다.

    - 신규: 매핑된 role + approved (포털이 이미 인가했다)
    - 기존: **강등하지 않는다.** admin 인 사람은 포털이 VIEWER 를 보내도 admin
      으로 남는다. 포털 role 은 승격에만 반영한다.
      status 가 pending/rejected 였다면 approved 로 올린다 — 포털을 통과했다는
      것이 우리 승인 절차보다 강한 근거다.
    """
    mapped = map_role(role_code)
    # 포털이 부서를 보내줬으면 디렉터리를 조회하지 않는다 — 다른 스키마를
    # 읽는 횟수를 줄이는 편이 낫다.
    department = (department_hint or "").strip() or None
    directory = {} if (department and full_name) else (lookup_portal_user(employee_no) or {})
    # 이름은 포털 디렉터리 > payload 순으로 신뢰한다(디렉터리가 정본이다).
    name = (directory.get("name") or full_name or "").strip()
    department = department or (directory.get("dept") or "").strip() or None

    r = (db().from_("user_profile")
         .select("id,email,full_name,department,role,status,employee_number")
         .eq("employee_number", employee_no).limit(1).execute())
    existing = (r.data or [None])[0]

    if existing:
        patch: dict = {}
        if existing.get("role") != "admin" and mapped == "admin":
            patch["role"] = "admin"          # 승격만
        if existing.get("status") != "approved":
            patch["status"] = "approved"
        # 이름·부서는 포털이 정본이므로 매 로그인마다 최신값으로 맞춘다
        # (부서 이동이 반영되어야 한다).
        if name and existing.get("full_name") != name:
            patch["full_name"] = name
        if department and existing.get("department") != department:
            patch["department"] = department
        if patch:
            upd = (db().from_("user_profile").update(patch)
                   .eq("id", existing["id"]).execute())
            return (upd.data or [existing])[0]
        return existing

    # 신규 생성. email 은 NOT NULL·UNIQUE 인데 포털이 주지 않으므로 사번으로
    # 만든 자리표시자를 넣는다. 실제 주소를 알게 되면 관리 화면에서 고친다.
    ins = db().from_("user_profile").insert({
        "email": f"{employee_no}@sso.local",
        "full_name": name or employee_no,
        "department": department,
        "employee_number": employee_no,
        "role": mapped,
        "status": "approved",
    }).execute()
    row = (ins.data or [None])[0]
    if row is None:
        raise TicketError("사용자 생성에 실패했습니다")
    return row
