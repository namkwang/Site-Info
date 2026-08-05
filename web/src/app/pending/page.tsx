import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { DB_SCHEMA } from "@/lib/db-schema";

export default async function PendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .schema(DB_SCHEMA)
    .from("user_profile")
    .select("status, reject_reason, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const isRejected = profile?.status === "rejected";

  return (
    <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-4">
      <div className="w-full max-w-[440px] bg-card rounded-xl border border-border shadow-sm p-6 flex flex-col gap-4 text-center">
        {isRejected ? (
          <>
            <h1 className="text-[18px] font-semibold text-destructive">가입이 거부되었습니다</h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              관리자가 가입 신청을 거부했습니다.
              {profile?.reject_reason && (
                <>
                  <br />
                  <span className="text-foreground">사유: {profile.reject_reason}</span>
                </>
              )}
              <br />
              자세한 사항은 관리자에게 문의해주세요.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[18px] font-semibold text-foreground">가입 승인 대기 중</h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              관리자가 가입 신청을 승인한 후 이용하실 수 있습니다.
              <br />
              승인이 지연된다면 관리자에게 문의해주세요.
            </p>
            <div className="text-[12px] text-muted-foreground pt-1">
              <span className="text-foreground">{profile?.full_name ?? user.email}</span>
              {" "}({user.email})
            </div>
          </>
        )}
        <div className="flex justify-center gap-2 pt-2">
          <SignOutButton />
          <Link href="/login" className="text-[12px] text-muted-foreground hover:underline self-center">
            다른 계정으로 로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
