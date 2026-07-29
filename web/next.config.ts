import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker용 self-contained 번들 — .next/standalone 디렉토리가 생성된다.
  output: "standalone",

  // 로컬 dev에서만 /api/* 를 FastAPI로 넘긴다. 운영에서는 nginx가 같은 일을
  // 하므로(브라우저 입장에서 동일 오리진) 여기서는 관여하지 않는다. 덕분에
  // 브라우저용 API 주소를 NEXT_PUBLIC_* 환경변수로 둘 필요가 없다.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const backend = process.env.DEV_API_PROXY ?? "http://localhost:8001";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
