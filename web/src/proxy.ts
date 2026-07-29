import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes accessible without authentication. Everything else requires login.
const PUBLIC_PATHS = ["/login", "/signup"];

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

  // supabase.auth.getUser() refreshes the session if needed — must run on
  // every request, otherwise the tokens expire and silent-fail later.
  const { data: { user } } = await supabase.auth.getUser();

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
  const { data: profile } = await supabase
    .schema("pmis")
    .from("user_profile")
    .select("status, role")
    .eq("id", user.id)
    .maybeSingle();

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
