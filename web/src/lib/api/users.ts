import { authFetch, handleMutation } from "./client";

export type UserStatus = "pending" | "approved" | "rejected";
export type UserRole = "viewer" | "admin";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  employee_number: string | null;
  corporation_id: number | null;
  role: UserRole;
  status: UserStatus;
  requested_at: string;
  approved_at: string | null;
  reject_reason: string | null;
}

export async function fetchUsers(status?: UserStatus | "all"): Promise<UserProfile[]> {
  const qs = !status || status === "all" ? "" : `?status=${status}`;
  const res = await authFetch(`/api/users${qs}`);
  if (!res.ok) throw new Error(`목록 조회 실패 (${res.status})`);
  return res.json();
}

export async function approveUser(id: string, role: UserRole): Promise<{ ok: boolean; user: UserProfile }> {
  const res = await authFetch(`/api/users/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  return handleMutation(res);
}

export async function rejectUser(id: string, reason: string | null): Promise<{ ok: boolean; user: UserProfile }> {
  const res = await authFetch(`/api/users/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return handleMutation(res);
}

export async function changeUserRole(id: string, role: UserRole): Promise<{ ok: boolean; user: UserProfile }> {
  const res = await authFetch(`/api/users/${id}/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  return handleMutation(res);
}

export async function deleteUser(id: string): Promise<{ ok: boolean }> {
  const res = await authFetch(`/api/users/${id}`, { method: "DELETE" });
  return handleMutation(res);
}
