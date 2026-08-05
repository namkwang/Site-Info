import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { DB_SCHEMA } from "@/lib/db-schema";

// Routes accessible without authentication. Everything else requires login.
const PUBLIC_PATHS = ["/login", "/signup"];

// user_profile(status/role) 조회 결과의 짧은 인메모리 캐시. 프로세스 단위라
// 재시작하면 비워지고, 사용자 수가 적어 크기 제한은 두지 않는다.
const PROFILE_CACHE_TTL = 30_000; // ms
const profileCache = new Map<
  string,
  { ts: number; profile: { status: string | null; role: string | null } | null }
>();

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims()는 JWT를 JWKS 공개키로 *로컬* 검증한다(비대칭 ES256) —
  // getUser()처럼 매 요청 Supabase Auth 왕복(수백 ms)이 없다. 토큰이
  // 만료됐을 때만 세션 갱신 왕복이 발생하므로 "매 요청 실행해서 만료를
  // 막는다"는 기존 getUser() 호출의 역할도 그대로 유지된다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ? { id: claimsData.claims.sub } : null;

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!user) {
    if (isPublic) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Logged in — send login/signup visitors back to dashboard.
  if (isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/statistics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Approval check: read own profile row (RLS allows this).
  // 매 페이지 이동마다 DB 왕복하지 않도록 30초 캐시 — 백엔드 deps.py의
  // _PROFILE_CACHE와 같은 트레이드오프(승인/권한 변경이 최대 30초 늦게 반영).
  let profile: { status: string | null; role: string | null } | null;
  const cached = profileCache.get(user.id);
  if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) {
    profile = cached.profile;
  } else {
    const { data } = await supabase
      .schema(DB_SCHEMA)
      .from("user_profile")
      .select("status, role")
      .eq("id", user.id)
      .maybeSingle();
    profile = data;
    profileCache.set(user.id, { ts: Date.now(), profile });
  }

  const status = profile?.status;
  const role = profile?.role;
  const isPending = !profile || status !== "approved";

  if (isPending && pathname !== "/pending") {
    const url = request.nextUrl.clone();
    url.pathname = "/pending";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!isPending && pathname === "/pending") {
    const url = request.nextUrl.clone();
    url.pathname = "/statistics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Admin-only area
  if (pathname.startsWith("/admin") && role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/statistics";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
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
