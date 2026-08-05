import { authFetch, handleMutation } from "./client";

/* ── Lookup response types — shared with site-form-dialog ── */

export interface Corporation { id: number; name: string; code: string }
export interface Region { code: string; name: string; region_group: string | null }
export interface FacilityType { code: string; name: string; division: string | null }
export interface ClientOrg { id: number; name: string; org_type: string | null }
export interface PartnerCompany { id: number; name: string; is_group_member: boolean }

/** 참조 테이블 읽기 — 백엔드 `/api/lookups` 한 번으로 받는다.
 *
 *  예전에는 브라우저가 Supabase 를 직접 조회했다. 인증을 우리가 하게 된 뒤로는
 *  RLS 가 우리 토큰을 알 수 없어(Supabase 가 발급한 토큰이 아니다) 직접 조회가
 *  불가능하다. 백엔드가 대신 읽어 주며, 왕복도 5회에서 1회로 줄었다.
 *
 *  발주유형 필터링(facility_type 에 섞여 들어온 BTL/CMR 등 제거)도 백엔드로
 *  옮겼다 — 같은 판단이 양쪽에 있으면 갈라진다. */


export interface Lookups {
  corporations: Corporation[];
  regions: Region[];
  facilityTypes: FacilityType[];
  clients: ClientOrg[];
  partners: PartnerCompany[];
  orderTypes: string[];
}

async function fetchLookups(): Promise<Lookups> {
  const res = await authFetch("/api/lookups");
  return handleMutation<Lookups>(res);
}

export async function fetchCorporations(): Promise<Corporation[]> {
  return (await fetchLookups()).corporations;
}

export async function fetchRegions(): Promise<Region[]> {
  return (await fetchLookups()).regions;
}

export async function fetchFacilityTypes(): Promise<FacilityType[]> {
  return (await fetchLookups()).facilityTypes;
}

export async function fetchClients(): Promise<ClientOrg[]> {
  return (await fetchLookups()).clients;
}

export async function fetchOrderTypes(): Promise<string[]> {
  return (await fetchLookups()).orderTypes;
}

export async function fetchPartners(): Promise<PartnerCompany[]> {
  return (await fetchLookups()).partners;
}

/** 폼이 전부 필요할 때 — 한 번의 요청으로 받아 기존 튜플 형태로 돌려준다.
 *  개별 fetch 를 6번 부르면 요청도 6번 나가므로 이쪽을 쓴다. */
export async function fetchAllLookups(): Promise<
  [Corporation[], Region[], FacilityType[], ClientOrg[], string[], PartnerCompany[]]
> {
  const l = await fetchLookups();
  return [l.corporations, l.regions, l.facilityTypes, l.clients, l.orderTypes, l.partners];
}
