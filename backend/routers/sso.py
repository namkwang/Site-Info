"""포털 SSO 엔드포인트.

  POST /api/v1/external/sso-ticket   포털 서버 → 우리 (공유 토큰 인증)
  POST /api/auth/sso/redeem          우리 프론트(/sso 라우트) → 우리

경로가 `/api/v1/external/...` 인 것은 그룹의 다른 시스템(자산관리)과 같은 계약을
쓰기 위해서다 — 포털이 시스템마다 다른 경로를 알 필요가 없다.
"""
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, field_validator

from services import sso, tokens
from services.fail_log import log_failure
from services.session_cookie import set_session

router = APIRouter()


class TicketRequest(BaseModel):
    # 모르는 필드를 버리지 않고 받아 둔다. 포털이 명세에 없는 값(부서 등)을
    # 보내도 조용히 사라지면 무엇이 오는지 알 수 없다 — 실제로 dept 가 오는지
    # 확인할 수 없어 이 설정을 넣었다.
    model_config = ConfigDict(extra="allow")

    employee_no: str
    role: Optional[str] = None
    name: Optional[str] = None
    # 부서. 포털이 실제로 보내는 이름은 `dept_name` 이다(로그로 확인). 명세
    # 예시에는 없었고 `dept` 로 짐작했다가 흘려보내고 있었다. 시스템마다 표기가
    # 다를 수 있어 흔한 변형을 모두 받는다 — 하나라도 오면 그 값을 쓴다.
    dept_name: Optional[str] = None
    dept: Optional[str] = None
    department: Optional[str] = None
    # 부서 코드도 함께 온다. 지금은 표시에 쓰지 않지만, 받는다는 사실을
    # 남겨 두면 나중에 조직 단위로 묶을 때 찾기 쉽다.
    dept_code: Optional[str] = None

    @field_validator("employee_no")
    @classmethod
    def _emp(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("employee_no 는 필수입니다")
        return v


@router.post("/api/v1/external/sso-ticket")
def issue_sso_ticket(
    body: TicketRequest,
    x_external_token: Optional[str] = Header(default=None, alias="X-External-Token"),
):
    """포털이 호출한다. 성공하면 60초·1회용 티켓을 돌려준다.

    role 이 없거나 우리가 모르는 값이어도 **422 를 내지 않는다** — 최소 권한으로
    폴백한다(명세 2번). 포털에 새 role 이 생겨도 로그인이 깨지지 않아야 한다.
    employee_no 누락만 422 다(pydantic 이 처리)."""
    if not sso.token_matches(x_external_token):
        raise HTTPException(status_code=401, detail="외부 연동 토큰이 일치하지 않습니다")

    # 포털이 실제로 보내는 필드를 기록한다(값이 아니라 키 목록). 명세와 실제가
    # 어긋날 때 추측 대신 확인할 수 있어야 한다.
    extras = sorted(set(body.model_dump(exclude_none=True)) - {"employee_no", "role", "name"})
    print(f"[sso] ticket request fields={sorted(body.model_dump(exclude_none=True))}"
          + (f" extra={extras}" if extras else ""))

    dept = (body.dept_name or body.dept or body.department or "").strip() or None
    try:
        ticket, ttl = sso.issue_ticket(body.employee_no, body.role, body.name, dept)
    except Exception as e:
        log_failure("sso.issue_ticket", e, source_key=body.employee_no)
        raise HTTPException(status_code=502, detail="티켓 발급에 실패했습니다")
    return {"ticket": ticket, "expires_in": ttl}


class RedeemRequest(BaseModel):
    ticket: str


@router.post("/api/auth/sso/redeem")
def redeem_sso_ticket(body: RedeemRequest, request: Request, response: Response):
    """티켓을 세션으로 바꾼다. 우리 프론트의 /sso 라우트가 호출한다.

    공유 토큰이 필요 없는 이유: 티켓 자체가 자격증명이다(60초·1회용·추측 불가).
    브라우저가 들고 오는 값이므로 외부 토큰을 여기서 요구할 수도 없다."""
    try:
        row = sso.redeem_ticket(body.ticket.strip())
        profile = sso.upsert_sso_user(row["employee_no"], row.get("role_code"),
                                      row.get("full_name"), row.get("department"))
    except sso.TicketError as e:
        raise HTTPException(status_code=401, detail=e.detail)
    except Exception as e:
        log_failure("sso.redeem", e)
        raise HTTPException(status_code=502, detail="SSO 처리에 실패했습니다")

    token, expires_in = tokens.issue(profile["id"], profile["email"],
                                     profile.get("role") or "viewer",
                                     profile.get("status") or "approved")
    set_session(response, request, token, expires_in)
    return {
        "ok": True,
        "access_token": token,
        "expires_in": expires_in,
        "user": {"id": profile["id"], "full_name": profile.get("full_name"),
                 "role": profile.get("role"), "status": profile.get("status")},
    }
