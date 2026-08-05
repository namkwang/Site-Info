"use client";

import { useEffect } from "react";

/** 승인 대기 화면에서 세션을 주기적으로 갱신한다.
 *
 *  승인 여부는 토큰의 status 로 판정한다(미들웨어가 DB 를 왕복하지 않기 위한
 *  선택). 그래서 관리자가 승인해도 토큰이 그대로면 계속 이 화면에 머문다.
 *  /api/auth/refresh 는 DB 의 현재 프로필로 토큰을 다시 발급하므로, 승인되면
 *  다음 갱신에서 통과되고 대시보드로 넘어간다. */
export function RefreshSessionOnMount() {
  useEffect(() => {
    let stopped = false;

    async function tick() {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (!res.ok) return;
        const body = await res.json();
        if (!stopped && body?.status === "approved") {
          // 미들웨어가 새 쿠키를 보고 판단하도록 전체 이동으로 넘긴다.
          window.location.href = "/statistics";
        }
      } catch {
        // 네트워크가 잠깐 끊긴 것뿐일 수 있다 — 다음 주기에 다시 시도한다.
      }
    }

    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
