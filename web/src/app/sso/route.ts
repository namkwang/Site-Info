import { NextResponse } from "next/server";

import { API_BASE } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session";

/** 포털 SSO 착지점 — `/sso?ticket=<티켓>`.
 *
 *  포털이 브라우저를 여기로 보낸다. 서버에서 백엔드에 티켓을 넘겨 세션을 받고,
 *  그 쿠키를 우리 응답에 실어 대시보드로 보낸다.
 *
 *  라우트 핸들러(서버)로 만든 이유: 티켓이 클라이언트 JS 를 거치지 않고,
 *  세션 쿠키도 HttpOnly 로 유지된다. 페이지 컴포넌트로 만들면 티켓이 화면
 *  로딩과 함께 브라우저 히스토리·리퍼러에 더 오래 남는다.
 *
 *  이 경로는 proxy.ts 의 matcher 에 걸리므로(=/api 가 아니다) 미들웨어를 먼저
 *  지난다. 아직 세션이 없으니 /login 으로 리디렉트될 텐데, 그러면 SSO 가 동작할
 *  수 없다 — PUBLIC_PATHS 에 /sso 를 넣어 통과시킨다. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(reason)}`, url.origin));

  if (!ticket) return fail("티켓이 없습니다");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/sso/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      cache: "no-store",
    });
  } catch {
    return fail("인증 서버에 연결할 수 없습니다");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return fail(typeof body?.detail === "string" ? body.detail : "SSO 인증에 실패했습니다");
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return fail("SSO 응답이 올바르지 않습니다");

  // 백엔드가 내려준 Set-Cookie 를 그대로 전달할 수도 있지만, SSR 이 서버-투-서버로
  // 부른 응답이라 도메인·Secure 판단이 어긋날 수 있다. 값만 받아 우리가 다시 심는다.
  const response = NextResponse.redirect(new URL("/statistics", url.origin));
  response.cookies.set(SESSION_COOKIE, body.access_token, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: body.expires_in ?? 8 * 3600,
  });
  return response;
}
