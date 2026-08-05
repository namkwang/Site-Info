"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  approveUser,
  changeUserRole,
  deleteUser,
  fetchUsers,
  rejectUser,
  type UserProfile,
  type UserRole,
  type UserStatus as Status,
} from "@/lib/api/users";

const CORP_NAME: Record<number, string> = { 1: "남광토건", 2: "극동건설", 3: "금광기업" };

const STATUS_LABEL: Record<Status, { label: string; variant: "brand" | "success" | "warning" | "gray" | "orange" }> = {
  pending:  { label: "승인 대기", variant: "orange" },
  approved: { label: "승인됨",    variant: "brand" },
  rejected: { label: "거부됨",    variant: "warning" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | "all">("pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await fetchUsers(filter));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string, role: UserRole) => {
    setBusy(id);
    try {
      await approveUser(id, role);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    const reason = prompt("거부 사유 (선택)");
    if (reason === null) return;
    setBusy(id);
    try {
      await rejectUser(id, reason);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (id: string, role: UserRole) => {
    setBusy(id);
    try {
      await changeUserRole(id, role);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, email: string) => {
    if (!confirm(`${email} 계정을 완전히 삭제할까요? 복구 불가합니다.`)) return;
    setBusy(id);
    try {
      await deleteUser(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold">사용자 관리</h1>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as Status | "all")}>
            <SelectTrigger size="sm" className="h-7! px-2.5! text-[11px]! font-normal! w-30 [&_svg]:size-2.5!">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending" className="text-[11px]">승인 대기</SelectItem>
              <SelectItem value="approved" className="text-[11px]">승인됨</SelectItem>
              <SelectItem value="rejected" className="text-[11px]">거부됨</SelectItem>
              <SelectItem value="all" className="text-[11px]">전체</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={load} disabled={loading} className="h-7 px-2.5 text-[11px] font-normal">
            새로고침
          </Button>
        </div>
      </div>

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="grid grid-cols-[1.7fr_1.3fr_1fr_1fr_1.1fr_1.5fr] gap-2 px-4 py-2 bg-muted/40 border-b border-border text-[12px] font-semibold text-muted-foreground">
          <span>이메일 / 이름</span>
          <span>소속 / 사번</span>
          <span>상태</span>
          <span>권한</span>
          <span>신청일</span>
          <span>작업</span>
        </div>
        {loading && users.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">불러오는 중...</div>
        ) : users.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">해당 조건의 사용자가 없습니다.</div>
        ) : (
          users.map((u) => {
            const sconf = STATUS_LABEL[u.status];
            const isBusy = busy === u.id;
            return (
              <div key={u.id} className="grid grid-cols-[1.7fr_1.3fr_1fr_1fr_1.1fr_1.5fr] gap-2 px-4 py-2 items-center border-b border-border/40 text-[12px]">
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-foreground truncate">{u.full_name || "(이름 없음)"}</span>
                  {/* SSO 사용자는 이메일이 자리표시자(@sso.local)라 부서를 대신
                      보여준다 — 목록에서 사람을 구분하려면 그쪽이 유용하다. */}
                  <span className="text-muted-foreground truncate">
                    {u.department || u.email}
                  </span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="truncate">{u.corporation_id != null ? CORP_NAME[u.corporation_id] ?? "-" : "-"}</span>
                  <span className="text-muted-foreground truncate">{u.employee_number ?? "-"}</span>
                </div>
                <span><Badge variant={sconf.variant} size="sm">{sconf.label}</Badge></span>
                <span>
                  <Badge variant={u.role === "admin" ? "brand" : "gray"} size="sm">
                    {u.role === "admin" ? "관리자" : "뷰어"}
                  </Badge>
                </span>
                <span className="text-muted-foreground">{u.requested_at?.slice(0, 10) ?? "-"}</span>
                <div className="flex flex-wrap gap-1">
                  {u.status === "pending" && (
                    <>
                      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => approve(u.id, "viewer")} disabled={isBusy}>뷰어 승인</Button>
                      <Button size="sm" className="h-6 px-2 text-[11px]" variant="default" onClick={() => approve(u.id, "admin")} disabled={isBusy}>관리자 승인</Button>
                      <Button size="sm" className="h-6 px-2 text-[11px]" variant="ghost" onClick={() => reject(u.id)} disabled={isBusy}>거부</Button>
                    </>
                  )}
                  {u.status === "approved" && (
                    <>
                      <Button size="sm" className="h-6 px-2 text-[11px]" variant="ghost" onClick={() => changeRole(u.id, u.role === "admin" ? "viewer" : "admin")} disabled={isBusy}>
                        {u.role === "admin" ? "관리자 해제" : "관리자 지정"}
                      </Button>
                      <Button size="sm" className="h-6 px-2 text-[11px]" variant="ghost" onClick={() => remove(u.id, u.email)} disabled={isBusy}>삭제</Button>
                    </>
                  )}
                  {u.status === "rejected" && (
                    <>
                      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => approve(u.id, "viewer")} disabled={isBusy}>재승인</Button>
                      <Button size="sm" className="h-6 px-2 text-[11px]" variant="ghost" onClick={() => remove(u.id, u.email)} disabled={isBusy}>삭제</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
