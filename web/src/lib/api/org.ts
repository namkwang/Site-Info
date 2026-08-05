import type { Department, OrgMember, OrgRole, OrgTreeNode, ResumeData } from "@/types/org-chart";
import { createClient } from "@/lib/supabase/client";
import { authFetch, handleMutation } from "./client";
import { DB_SCHEMA } from "@/lib/db-schema";

/* ── Reads — direct Supabase where there's no business logic ── */

/** All four slices the org-chart dialog needs in a single round-trip.
 *  The dialog used to fan-out: org chart + departments + roles +
 *  required-headcount in parallel from the browser. Each call paid for
 *  its own JWT-validation + getSession() lock contention; folding into
 *  one backend handler measurably shortens the open-to-data delay. */
export interface OrgChartBundle {
  members: OrgMember[];
  departments: Department[];
  roles: OrgRole[];
  required_headcount: { general: number; specialist: number; contract: number; jv: number };
}

export async function fetchOrgChartBundle(siteId: number): Promise<OrgChartBundle> {
  const res = await authFetch(`/api/sites/${siteId}/org-chart-bundle`);
  return handleMutation<OrgChartBundle>(res);
}

/** Site org chart. Reads `pmis.v_site_org_chart` directly — the view
 *  pre-joins `site_org_member` with `org_role` and `site_department`
 *  and is row-level-secured (migration 013 → security_invoker, so the
 *  underlying tables' approved-user policies apply). */
export async function fetchOrgChart(siteId: number): Promise<OrgMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("v_site_org_chart")
    .select("*")
    .eq("site_id", siteId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as OrgMember[];
}

export async function fetchOrgRoles(): Promise<OrgRole[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("org_role")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as OrgRole[];
}

/** Departments still go through the backend — first read on a new site
 *  triggers default-department seeding (see services/org.py). Pure
 *  Supabase read would skip that side effect. */
export async function fetchDepartments(siteId: number): Promise<Department[]> {
  const res = await authFetch(`/api/sites/${siteId}/departments`);
  return res.json();
}

/* ── Departments ── */

export async function createDepartment(siteId: number, name: string): Promise<Department> {
  const res = await authFetch(`/api/sites/${siteId}/departments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return handleMutation<Department>(res);
}

export async function updateDepartment(
  deptId: number,
  patch: { name?: string; sort_order?: number },
): Promise<Department> {
  const res = await authFetch(`/api/departments/${deptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handleMutation<Department>(res);
}

export async function deleteDepartment(deptId: number): Promise<void> {
  const res = await authFetch(`/api/departments/${deptId}`, { method: "DELETE" });
  await handleMutation<{ ok: boolean }>(res);
}

/* ── Required headcount ── */

export type RequiredHeadcount = {
  general: number;
  specialist: number;
  contract: number;
  jv: number;
};

export async function fetchRequiredHeadcount(siteId: number): Promise<RequiredHeadcount> {
  const res = await authFetch(`/api/sites/${siteId}/required-headcount`);
  if (!res.ok) return { general: 0, specialist: 0, contract: 0, jv: 0 };
  return res.json();
}

export async function updateRequiredHeadcount(
  siteId: number,
  payload: RequiredHeadcount,
): Promise<RequiredHeadcount> {
  const res = await authFetch(`/api/sites/${siteId}/required-headcount`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleMutation<RequiredHeadcount>(res);
}

/* ── Members ── */

export type OrgMemberInput = {
  name: string;
  role_id: number;
  department_id: number | null;
  parent_id: number | null;
  org_type: "OWN" | "JV" | "SUB";
  employee_type: "일반직" | "전문직" | "현채직" | "공동사";
  company_name: string | null;
  rank: string | null;
  phone: string | null;
  email: string | null;
  sort_order?: number;
  is_active?: boolean;
  // Profile fields (migration 002 columns).
  birth_date?: string | null;
  address?: string | null;
  phone_work?: string | null;
  photo_url?: string | null;
  job_category?: string | null;
  entry_type?: string | null;
  task_detail?: string | null;
  hobby?: string | null;
  skills?: string | null;
  resume_data?: ResumeData | null;
};

export async function createOrgMember(
  siteId: number,
  payload: OrgMemberInput,
): Promise<{ id: number }> {
  const res = await authFetch(`/api/sites/${siteId}/org-members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleMutation<unknown>(res);
  const row = Array.isArray(data) ? (data[0] as { id: number }) : (data as { id: number });
  return { id: row.id };
}

export async function updateOrgMember(
  memberId: number,
  patch: Partial<OrgMemberInput>,
): Promise<void> {
  const res = await authFetch(`/api/org-members/${memberId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await handleMutation<unknown>(res);
}

export async function deleteOrgMember(memberId: number): Promise<void> {
  const res = await authFetch(`/api/org-members/${memberId}`, { method: "DELETE" });
  await handleMutation<{ ok: boolean }>(res);
}

/* ── Member profile (employee detail panel) ── */

export interface OrgMemberPeer {
  id: number;
  name: string;
  rank: string | null;
  role_name: string;
  phone_work?: string;
  photo_url?: string;
}

export interface OrgMemberProfile {
  member: OrgMember;
  resume: ResumeData;
  peers: OrgMemberPeer[];
}

export async function fetchOrgMemberProfile(memberId: number): Promise<OrgMemberProfile | null> {
  const res = await authFetch(`/api/org-members/${memberId}/profile`);
  if (!res.ok) return null;
  return res.json();
}

/* ── Photo upload ── */

export async function uploadOrgPhoto(file: File | Blob, memberId: number | string): Promise<{ ok: boolean; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("member_id", String(memberId));
  const res = await authFetch(`/api/upload-org-photo`, { method: "POST", body: formData });
  return handleMutation(res);
}

/* ── Tree helpers (pure) ── */

/** flat list -> tree */
export function buildOrgTree(members: OrgMember[]): OrgTreeNode[] {
  const map = new Map<number, OrgTreeNode>();
  const roots: OrgTreeNode[] = [];

  for (const m of members) {
    map.set(m.id, { ...m, children: [] });
  }
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortChildren = (nodes: OrgTreeNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    nodes.forEach((n) => sortChildren(n.children));
  };
  sortChildren(roots);
  return roots;
}

/** 부서별로 그룹핑 (최상위 제외) */
export function groupByDepartment(members: OrgMember[]) {
  const topLevel = members.filter((m) => m.parent_id == null);
  const departments = new Map<string, OrgMember[]>();
  const noDept: OrgMember[] = [];

  for (const m of members) {
    if (m.parent_id == null) continue;
    const deptName = m.department_name ?? "기타";
    if (!departments.has(deptName)) departments.set(deptName, []);
    departments.get(deptName)!.push(m);
  }

  return { topLevel, departments, noDept };
}
