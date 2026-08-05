import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** 세션 토큰(우리가 발급한 JWT) 검증 — 서버 전용.
 *
 *  백엔드(services/tokens.py)가 HS256 으로 서명한 토큰을 같은 비밀키로 검증한다.
 *  미들웨어에서 쓰기 때문에 검증은 **로컬**이어야 한다 — 페이지 이동마다 백엔드에
 *  물어보면 왕복이 늘고, 그 왕복을 없애려고 애쓴 것이 무의미해진다.
 *
 *  Next 16 의 proxy.ts 는 Node.js 런타임에서 돌기 때문에 node:crypto 를 쓸 수 있고,
 *  덕분에 JWT 라이브러리를 추가하지 않아도 된다. HMAC 검증은 서명 재계산 후
 *  상수 시간 비교가 전부다.
 *
 *  `import "server-only"` 로 클라이언트 번들 유입을 컴파일 단계에서 막는다 —
 *  APP_JWT_SECRET 이 브라우저로 새면 누구나 토큰을 위조할 수 있다. */

export const SESSION_COOKIE = "si_session";

export interface SessionClaims {
  sub: string;
  email?: string;
  role: string;
  status: string;
  exp: number;
  iat: number;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** 토큰이 유효하면 claims 를, 아니면 null 을 돌려준다. 던지지 않는다 —
 *  미들웨어는 "유효한가"만 알면 되고, 사유별 분기가 필요 없다. */
export function verifySession(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const secret = process.env.APP_JWT_SECRET;
  if (!secret || secret.length < 32) {
    // 조용히 통과시키면 인증 없이 접근이 열린다. 거부하는 편이 안전하다.
    console.error("[session] APP_JWT_SECRET 이 없거나 너무 짧습니다 — 모든 세션을 거부합니다");
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  let claims: SessionClaims;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
    claims = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  // alg 를 토큰이 말하는 대로 믿으면 "alg":"none" 이나 알고리즘 혼동 공격에
  // 그대로 걸린다. 우리가 쓰는 값만 받는다.
  if (header.alg !== "HS256") return null;

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = b64urlToBuffer(signatureB64);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  // 백엔드와 같은 30초 여유 — 서버 시계가 몇 초 어긋나도 방금 발급한 토큰이
  // 거부되지 않게 한다(실제로 이 문제를 겪었다).
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + 30 < now) return null;

  return claims;
}
