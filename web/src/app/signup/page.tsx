"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CORPORATIONS = [
  { id: 1, name: "남광토건" },
  { id: 2, name: "극동건설" },
  { id: 3, name: "금광기업" },
];

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [corporationId, setCorporationId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (!fullName.trim() || !employeeNumber.trim() || !corporationId) {
      setError("모든 항목을 입력해주세요.");
      return;
    }
    setLoading(true);
    // 가입은 백엔드가 처리한다 — auth에는 계정만 만들고 프로필은 pmis에
    // 직접 쓴다(auth.users 트리거 없음). supabase.auth.signUp을 쓰지 말 것.
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName.trim(),
          employee_number: employeeNumber.trim(),
          corporation_id: Number(corporationId),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.detail === "string" ? body.detail : "가입 중 오류가 발생했습니다."
        );
        return;
      }
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
      return;
    } finally {
      setLoading(false);
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-4">
        <div className="w-full max-w-[380px] bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col gap-3 text-center">
          <h1 className="text-[15px] font-semibold text-foreground">가입 신청 완료</h1>
          <p className="text-[11.5px] text-muted-foreground leading-relaxed">
            관리자 승인 후 이용하실 수 있습니다.<br />
            승인까지 시간이 걸릴 수 있습니다.
          </p>
          <Button size="sm" onClick={() => router.replace("/login")} className="text-[12px]">로그인 페이지로</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[380px] bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col gap-3">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">가입 신청</h1>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">
            관리자 승인 후 이용하실 수 있습니다.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
          <Field htmlFor="email" label="이메일">
            <Input size="sm" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="text-[13px]! h-8! py-1! px-3!" />
          </Field>
          <Field htmlFor="password" label="비밀번호" hint="(8자 이상)">
            <PasswordInput size="sm" id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} className="text-[13px]! h-8! py-1! px-3!" />
          </Field>
          <Field htmlFor="password-confirm" label="비밀번호 확인">
            <PasswordInput size="sm" id="password-confirm" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" required className="text-[13px]! h-8! py-1! px-3!" />
          </Field>
          <Field htmlFor="name" label="이름">
            <Input size="sm" id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required className="text-[13px]! h-8! py-1! px-3!" />
          </Field>
          <Field htmlFor="employee-number" label="사번">
            <Input size="sm" id="employee-number" value={employeeNumber} onChange={(e) => setEmployeeNumber(e.target.value)} required className="text-[13px]! h-8! py-1! px-3!" />
          </Field>
          <Field htmlFor="corporation" label="소속 법인">
            <Select value={corporationId} onValueChange={setCorporationId}>
              <SelectTrigger size="sm" id="corporation" className="w-full text-[13px]! h-8! py-1! px-3! [&_svg]:size-3.5!">
                <SelectValue placeholder="법인을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {CORPORATIONS.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} className="text-[13px]">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={loading} className="mt-1 text-[13px]">
            {loading ? "신청 중..." : "가입 신청"}
          </Button>
          <div className="text-center text-[11.5px] text-muted-foreground pt-0.5">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="text-primary font-semibold hover:underline">
              로그인
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ htmlFor, label, hint, children }: { htmlFor: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-[12px]">
        {label}
        {hint && <span className="ml-1 text-muted-foreground font-normal">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
