"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { DB_SCHEMA } from "@/lib/db-schema";

/**
 * Client-side auth state fed by Supabase.
 *
 * Pages rely on this for conditional UI (isAdmin gates, user name, etc.).
 * The real security boundary is the backend (JWT verification) + Next.js
 * middleware (route gating). This context is only for rendering.
 */

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected";
  employee_number: string | null;
  corporation_id: number | null;
  phone: string | null;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  // Dedup guard: avoid re-fetching the same profile when both `refresh()`
  // (mount) and `onAuthStateChange` (initial session callback) fire for
  // the same user, which is the normal Supabase-js sequence.
  const lastProfileUserIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    if (lastProfileUserIdRef.current === userId) return;
    lastProfileUserIdRef.current = userId;
    const { data } = await supabase
      .schema(DB_SCHEMA)
      .from("user_profile")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile((data as UserProfile | null) ?? null);
  }, [supabase]);

  const refresh = useCallback(async () => {
    // `getSession()` reads from the locally-stored session — no /auth/v1/user
    // network call. Backend now verifies the JWT signature locally on every
    // request (see `backend/deps.py` JWKS-based verification), so client-side
    // we just need the session for displaying user info / firing fetches.
    const { data: { session } } = await supabase.auth.getSession();
    const u = session?.user ?? null;
    setUser(u);
    if (u) await loadProfile(u.id);
    else {
      setProfile(null);
      lastProfileUserIdRef.current = null;
    }
  }, [supabase, loadProfile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) await loadProfile(u.id);
      else {
        setProfile(null);
        lastProfileUserIdRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadProfile, refresh]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supabase]);

  const value: AuthContextValue = {
    user,
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
