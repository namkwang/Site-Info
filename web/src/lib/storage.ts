/** Supabase 스토리지 버킷 이름과 공개 URL 조립.
 *
 *  버킷은 프로젝트 전역 자원이라 스키마(DB_SCHEMA)처럼 환경별로 다르게 두지
 *  않고 이름 한 벌을 공유한다. 팀 공용 프로젝트의 기존 버킷은 서비스 접두어를
 *  쓰므로(cons-attend-uploads 등) 나중에 site-info- 접두어로 바꾸는 게 규약에
 *  맞다 — 그때 여기와 backend/constants.py 두 곳만 고치면 된다. */
export const BUCKET_ORG_PHOTOS = "org-photos";
export const BUCKET_SITE_IMAGES = "site-images";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

/** 버킷의 공개 객체 URL. SUPABASE_URL 이 없으면 null (빌드 시 env 누락). */
export function publicUrl(bucket: string, path: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/** 조직원 사진 — photo_url 이 없을 때의 관례 경로(member_<id>.jpg). */
export function orgPhotoUrl(memberId: number | string): string | null {
  return publicUrl(BUCKET_ORG_PHOTOS, `member_${memberId}.jpg`);
}
