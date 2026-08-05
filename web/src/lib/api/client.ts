import { API_BASE } from "@/lib/env";

/** 브라우저용 fetch 래퍼.
 *
 *  세션은 HttpOnly 쿠키에 있고 브라우저가 자동으로 붙여 보내므로, 여기서 토큰을
 *  읽거나 헤더를 만들 일이 없다(JS 는 그 쿠키를 읽을 수도 없다). 예전에는
 *  Supabase 세션에서 JWT 를 꺼내 Authorization 헤더에 넣었다.
 *
 *  동일 오리진 요청이어야 쿠키가 붙는다 — 브라우저는 항상 `/api/*` 를 부르고
 *  운영에서는 nginx, 개발에서는 next.config 의 rewrite 가 백엔드로 넘긴다.
 *  `credentials: "same-origin"` 이 기본값이지만 의도를 드러내려고 명시한다. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { ...init, credentials: "same-origin" });
}

/** Pure fetch wrapper that takes an already-acquired bearer token (or
 *  none). Both `authFetch` (client) and `authFetchServer` (server) use
 *  this internally; data-layer helpers (fetchSites, etc.) call this
 *  directly when a server caller passes the token in. */
export async function fetchWithAuth(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...rest, headers });
}

/** Read mutation responses uniformly: success = `.json()`, failure = throw with
 *  the backend's `detail` field (or a generic message). Used by every api/*.ts
 *  module so error UX is consistent across the app. */
export async function handleMutation<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "요청 실패";
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export { API_BASE };
