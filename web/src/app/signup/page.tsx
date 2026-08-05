import Link from "next/link";

import { Button } from "@/components/ui/button";

/** 직접 가입은 사용하지 않는다.
 *
 *  사용자 관리는 그룹 포털이 담당한다 — 포털에서 로그인하면 SSO 로 계정이
 *  자동 생성되고 권한도 포털이 부여한 값으로 정해진다. 여기로 가입할 수 있으면
 *  포털을 거치지 않은 계정이 생겨 그 통제가 무의미해진다.
 *
 *  페이지를 지우지 않고 안내로 남긴 이유: 기존 링크·북마크로 들어오는 사람이
 *  404 대신 무엇을 해야 하는지 보게 하기 위해서다. */
export default function SignupPage() {
  return (
    <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] bg-card rounded-xl border border-border shadow-sm p-6 flex flex-col gap-3 text-center">
        <h1 className="text-[16px] font-semibold text-foreground">그룹 포털에서 로그인해주세요</h1>
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">
          이 시스템은 별도 가입 절차가 없습니다.<br />
          그룹 포털에서 로그인하시면 계정이 자동으로 생성되고,
          권한도 포털에 설정된 값으로 부여됩니다.
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          포털에 접근할 수 없거나 권한이 맞지 않으면 관리자에게 문의해주세요.
        </p>
        <Button asChild size="sm" variant="ghost" className="text-[12px] mt-1">
          <Link href="/login">로그인 화면으로</Link>
        </Button>
      </div>
    </div>
  );
}
