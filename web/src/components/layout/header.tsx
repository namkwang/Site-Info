"use client";

import Link from "next/link";
import { Bell, LogOut, ShieldCheck, Users, Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

export function Header() {
  const { profile, isAdmin, signOut } = useAuth();
  const router = useRouter();

  const avatarText = (profile?.full_name ?? profile?.email ?? "").trim().charAt(0) || "?";

  // 포털 SSO 사용자는 이메일이 자리표시자(21226064@sso.local)라 그대로 보여주면
  // 사람을 알아볼 수 없다. 포털과 같은 형식으로 이름 · 부서를 쓰고, 둘 다 없을
  // 때만 이메일로 떨어진다.
  const displayName = [profile?.full_name?.trim(), profile?.department?.trim()]
    .filter(Boolean)
    .join(" · ") || profile?.email || "";

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="h-11 bg-background backdrop-blur-xl border-b border-border/50 flex items-center justify-between px-4 sticky top-0 z-30 transition-colors shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/statistics" className="text-[18px] font-semibold text-foreground whitespace-nowrap tracking-tight hover:text-primary transition-colors">
          전사 현장 통합 대시보드
        </Link>
      </div>

      <div className="flex items-center gap-1.5">
        {profile && isAdmin && (
          <>
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-card/60"
              title="사용자 관리"
            >
              <Users className="h-3 w-3" />
              사용자
            </Link>
            <Link
              href="/statistics?addSite=1"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-card/60"
              title="현장 관리"
            >
              <MapPin className="h-3 w-3" />
              현장 관리
            </Link>
            <Link
              href="/admin/managing-entities"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-card/60"
              title="현장관리부서"
            >
              <Building2 className="h-3 w-3" />
              현장관리부서
            </Link>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold">
              <ShieldCheck className="h-3 w-3" />
              관리자
            </span>
          </>
        )}
        {profile && (
          <span className="hidden sm:inline text-[12px] text-muted-foreground">
            {displayName}
          </span>
        )}
        {profile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-foreground hover:bg-card/60 gap-1 text-[12px] h-7 px-2"
          >
            <LogOut className="h-3 w-3" />
            로그아웃
          </Button>
        )}
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-card/60 h-7 w-7">
          <Bell className="h-4 w-4" />
        </Button>
        <div className="h-7 w-7 rounded-full bg-blue-500 text-white text-[11px] font-semibold flex items-center justify-center shadow-sm ring-2 ring-border/60 uppercase">
          {avatarText}
        </div>
      </div>
    </header>
  );
}
