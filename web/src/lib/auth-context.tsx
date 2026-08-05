"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * 클라이언트 인증 상태 — 백엔드 `/api/me` 가 원본이다.
 *
 * 세션은 HttpOnly 쿠키에 있어 JS 가 읽을 수 없다. 그래서 사용자 정보는 토큰을
 * 파싱해서 얻는 게 아니라 백엔드에 물어본다. 브라우저가 쿠키를 자동으로 붙여
 * 보내므로 헤더를 다룰 일이 없다.
 *
 * 이 컨텍스트는 화면 표시용이다(이름, 관리자 메뉴 노출 등). 실제 보안 경계는
 * 백엔드(토큰 검증 + 승인상태 확인)와 proxy.ts(라우팅 차단)다.
 */

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: "viewer" | "admin";
  status: "pending" | "approved" | "rejected";
  employee_number: string | null;
  corporation_id: number | null;
  must_change_password?: boolean;
}

interface AuthContextValue {
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      setProfile(res.ok ? ((await res.json()) as UserProfile) : null);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    // 쿠키는 서버가 지운다 — HttpOnly 라 클라이언트에서 지울 수 없다.
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setProfile(null);
    // 미들웨어가 쿠키 없는 요청을 /login 으로 보내므로 전체 이동으로 넘긴다.
    window.location.href = "/login";
  }, []);

  const value: AuthContextValue = {
    profile,
    loading,
    isAdmin: profile?.role === "admin" && profile?.status === "approved",
    isApproved: profile?.status === "approved",
    signOut,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
