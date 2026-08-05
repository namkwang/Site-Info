"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/statistics";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // 로그인은 백엔드가 처리한다. 세션은 응답의 HttpOnly 쿠키로 설정되므로
    // 여기서 토큰을 다루지 않는다(JS 가 읽을 수 없어 XSS 로도 새지 않는다).
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // 잠금(429) 같은 경우는 서버 문구가 사용자에게 필요한 정보를 담고 있다.
        setError(
          typeof body?.detail === "string"
            ? body.detail
            : "이메일 또는 비밀번호가 올바르지 않습니다."
        );
        return;
      }
      const body = await res.json();
      // 관리자가 지정한 초기 비밀번호면 먼저 바꾸게 한다.
      router.replace(body?.must_change_password ? "/account/password" : next);
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="email" className="text-[12px]">이메일</Label>
        <Input
          size="sm"
          id="email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          autoComplete="email"
          autoFocus
          required
          className="text-[13px]! h-8! py-1! px-3!"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="password" className="text-[12px]">비밀번호</Label>
        <PasswordInput
          size="sm"
          id="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          autoComplete="current-password"
          required
          className="text-[13px]! h-8! py-1! px-3!"
        />
      </div>
      {error && <p className="text-[11.5px] text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={loading} className="mt-1 text-[13px]">
        {loading ? "로그인 중..." : "로그인"}
      </Button>
      {/* 계정은 그룹 포털이 만든다 — 직접 가입은 닫혔다. 링크를 남겨두면
          누르는 사람마다 403 을 만나므로 안내로 바꾼다. */}
      <div className="text-center text-[11.5px] text-muted-foreground pt-0.5">
        계정이 없으신가요? 그룹 포털에서 로그인하면 자동으로 생성됩니다.
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        <div className="rounded-[6px] border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-[11.5px] text-slate-700 leading-relaxed flex flex-col gap-1.5">
          <span className="font-semibold text-blue-700">[안내]</span>
          <p>데이터 보안 강화를 위해 로그인 기능이 추가되었습니다.</p>
          <p>현장별 정보 접근 권한을 체계적으로 관리하기 위한 조치이오니, 번거로우시더라도 양해 부탁드립니다.</p>
          <p>계정은 관리자 승인 후 사용 가능합니다.</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col gap-3">
          <div>
            <h1 className="text-[15px] font-semibold text-foreground">로그인</h1>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              전사 현장 통합 대시보드에 접근하려면 로그인하세요.
            </p>
          </div>
          <Suspense fallback={<div className="text-[12px] text-muted-foreground">로딩 중...</div>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
