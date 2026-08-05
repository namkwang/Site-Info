"use client";

import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function SignOutButton({ variant = "default" }: { variant?: "default" | "ghost" }) {
  const { signOut } = useAuth();

  async function onClick() {
    // 쿠키 삭제는 서버가 한다(HttpOnly). signOut 이 끝나면 /login 으로 이동한다.
    await signOut();
  }

  return (
    <Button variant={variant} size="sm" onClick={onClick} className="gap-1 text-[12px] h-7 px-2">
      <LogOut className="h-3 w-3" />
      로그아웃
    </Button>
  );
}
