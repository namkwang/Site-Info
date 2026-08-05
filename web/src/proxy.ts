import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Routes accessible without authentication. Everything else requires login.
// /sso 는 포털에서 티켓을 들고 도착하는 지점이라 세션이 아직 없다 — 막으면
// SSO 가 동작할 수 없다. 그 라우트가 티켓을 검증하고 세션을 만든다.
const PUBLIC_PATHS = ["/login", "/signup", "/sso"];

/** 라우팅 게이트.
 *
 *  세션 토큰은 우리가 발급하고(백엔드 /api/auth/login), HttpOnly 쿠키로 온다.
 *  여기서는 그 쿠키를 **로컬에서** 검증한다 — DB 도 외부 인증 서버도 부르지
 *  않으므로 페이지 이동에 왕복이 없다. 승인상태(status)와 권한(role)이 토큰에
 *  들어 있어서 프로필 조회도 필요 없다.
 *
 *  대가: status/role 은 발급 시점 값이다. 관리자가 승인해도 토큰을 갱신해야
 *  반영된다 — /pending 화면이 /api/auth/refresh 를 호출해서 처리한다. */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const claims = verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!claims) {
    if (isPublic) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    const res = NextResponse.redirect(url);
    // 만료·위조된 쿠키가 남아 있으면 매 요청 검증만 실패하며 따라다닌다.
    if (request.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Logged in — send login/signup visitors back to dashboard.
  // /sso 는 예외다: 포털이 다른 계정으로 넘겨줄 수 있으므로 티켓을 처리하게 둔다.
  if (isPublic && pathname !== "/sso") {
    const url = request.nextUrl.clone();
    url.pathname = "/statistics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isApproved = claims.status === "approved";

  if (!isApproved && pathname !== "/pending") {
    const url = request.nextUrl.clone();
    url.pathname = "/pending";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isApproved && pathname === "/pending") {
    const url = request.nextUrl.clone();
    url.pathname = "/statistics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Admin-only area
  if (pathname.startsWith("/admin") && claims.role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/statistics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip static assets and Next internals; run on everything else.
    // `api`도 제외 — 운영에서는 nginx가 /api 를 백엔드로 바로 보내 Proxy가
    // 아예 안 타고, dev에서는 next.config 의 rewrite 가 같은 역할을 한다.
    // Proxy는 rewrite보다 먼저 돌기 때문에 제외하지 않으면 비로그인 API 호출이
    // 401 대신 /login 리디렉트로 응답해 운영과 동작이 갈린다.
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
