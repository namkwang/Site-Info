import { createClient } from "@/lib/supabase/client";
import { DB_SCHEMA } from "@/lib/db-schema";

/* ── Lookup response types — shared with site-form-dialog ── */

export interface Corporation { id: number; name: string; code: string }
export interface Region { code: string; name: string; region_group: string | null }
export interface FacilityType { code: string; name: string; division: string | null }
export interface ClientOrg { id: number; name: string; org_type: string | null }
export interface PartnerCompany { id: number; name: string; is_group_member: boolean }

/** Reference-table reads. These tables are protected by RLS — only an
 *  approved authenticated user can SELECT (see migration 012). The
 *  browser Supabase client auto-attaches the user's JWT, so no manual
 *  auth header juggling here.
 *
 *  We deliberately bypass the Python backend for these reads: the
 *  payload is small reference data and skipping the extra Next.js → Python
 *  hop saves 10–30 ms per call. Mutations to these tables (and any
 *  read that needs server-side caching or business logic) still go
 *  through the backend. */

const ORDER_TYPES = ["BTL", "CMR", "공공", "민간", "외주"];

export async function fetchCorporations(): Promise<Corporation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("corporation")
    .select("id,name,code")
    .order("id");
  if (error) throw error;
  return (data ?? []) as Corporation[];
}

export async function fetchRegions(): Promise<Region[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("region_code")
    .select("code,name,region_group")
    .order("code");
  if (error) throw error;
  return (data ?? []) as Region[];
}

export async function fetchFacilityTypes(): Promise<FacilityType[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("facility_type")
    .select("code,name,division")
    .order("name");
  if (error) throw error;
  // facility_type 테이블에 발주유형(BTL/CMR/민간 등)이 섞여 들어와 있어 제거
  // (백엔드 라우터가 하던 필터를 클라이언트로 옮김 — 양쪽이 일치해야 한다)
  return ((data ?? []) as FacilityType[]).filter((row) => !ORDER_TYPES.includes(row.name ?? ""));
}

export async function fetchClients(): Promise<ClientOrg[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("client_org")
    .select("id,name,org_type")
    .order("name");
  if (error) throw error;
  return (data ?? []) as ClientOrg[];
}

export async function fetchOrderTypes(): Promise<string[]> {
  // 발주유형은 lookup 테이블이 없고 ORDER_TYPES 상수로 관리되므로 그대로 노출.
  return Promise.resolve([...ORDER_TYPES].sort());
}

export async function fetchPartners(): Promise<PartnerCompany[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema(DB_SCHEMA)
    .from("partner_company")
    .select("id,name,is_group_member")
    .order("name");
  if (error) throw error;
  return (data ?? []) as PartnerCompany[];
}

/** Convenience: fetch every lookup in parallel for forms that need them all
 *  (used by site-form-dialog). Returns a tuple in a stable order. */
export async function fetchAllLookups(): Promise<
  [Corporation[], Region[], FacilityType[], ClientOrg[], string[], PartnerCompany[]]
> {
  return Promise.all([
    fetchCorporations(),
    fetchRegions(),
    fetchFacilityTypes(),
    fetchClients(),
    fetchOrderTypes(),
    fetchPartners(),
  ]);
}
