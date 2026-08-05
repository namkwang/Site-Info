import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/lib/session";
import { fetchWithAuth } from "./client";

/** 서버 컴포넌트·라우트 핸들러용 fetch 래퍼.
 *
 *  브라우저 요청에는 쿠키가 자동으로 붙지만, SSR 에서 백엔드로 나가는 요청은
 *  서버가 새로 만드는 것이라 자동으로 따라가지 않는다. 요청 쿠키에서 세션
 *  토큰을 꺼내 Authorization 헤더로 넘긴다.
 *
 *  `import "server-only"` 로 클라이언트 번들 유입을 컴파일 단계에서 막는다. */
export async function getServerAuthToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function authFetchServer(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithAuth(path, { ...init, token: await getServerAuthToken() });
}
