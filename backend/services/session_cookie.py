"""세션 쿠키 설정.

토큰을 localStorage 가 아니라 HttpOnly 쿠키로 둔다:
  - JS 가 읽을 수 없으므로 XSS 로 토큰이 새지 않는다.
  - SSR(Next proxy.ts)이 요청 쿠키에서 바로 읽을 수 있다.
  - 브라우저가 자동으로 붙여 보내므로 프론트가 토큰을 다룰 일이 없다.

SameSite=Lax 로 두면 외부 사이트에서 시작된 요청에는 쿠키가 붙지 않아
CSRF 위험이 크게 줄고, 일반적인 링크 이동은 정상 동작한다.
"""
from fastapi import Request, Response

COOKIE_NAME = "si_session"


def _is_https(request: Request) -> bool:
    """운영에서는 nginx 가 앞에 있어 X-Forwarded-Proto 로 판단한다.
    로컬 http 개발에서 Secure 를 붙이면 쿠키가 아예 저장되지 않는다."""
    proto = request.headers.get("x-forwarded-proto", "")
    return proto.split(",")[0].strip() == "https" or request.url.scheme == "https"


def set_session(response: Response, request: Request, token: str, max_age: int) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=max_age,
        httponly=True,
        secure=_is_https(request),
        samesite="lax",
        path="/",
    )


def clear_session(response: Response, request: Request) -> None:
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True,
        secure=_is_https(request), samesite="lax",
    )
