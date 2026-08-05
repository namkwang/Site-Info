-- 016: auth 스키마에서 손 떼기 — 사용자 관리를 pmis 안으로 완결
--
-- 배경: DB를 팀 공용 Supabase 프로젝트로 이전할 예정이고, 거기서는 다른
--   스키마(auth 포함)를 절대 건드리면 안 된다. Supabase Auth의 역할은
--   계정(이메일·비밀번호) 보관과 JWT 발급뿐이어야 한다.
--
-- 조치:
--   1) auth.users의 AFTER INSERT 트리거 제거 — 프로필 생성은 이제
--      백엔드 POST /api/auth/signup 이 pmis.user_profile에 직접 한다.
--      (트리거 방식은 팀 프로젝트의 다른 서비스 가입자에게도 pmis 프로필을
--      만들어버리고, 공유 테이블에 우리 객체를 남긴다)
--   2) user_profile → auth.users FK 2개 제거 — auth 스키마로의 의존성을
--      끊는다. id/approved_by는 이후 일반 UUID 값으로만 다룬다.
--      (탈퇴 시 프로필 정리는 admin 삭제 API가 명시적으로 처리)
--
-- 이 파일은 개인 프로젝트에 남아 있는 객체를 걷어내는 용도다. 팀 프로젝트에는
-- 애초에 이 객체들을 만들지 않는다 (이전용 통합 init 스크립트에서 제외).

BEGIN;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS pmis.handle_new_auth_user();

ALTER TABLE pmis.user_profile
  DROP CONSTRAINT IF EXISTS user_profile_id_fkey,
  DROP CONSTRAINT IF EXISTS user_profile_approved_by_fkey;

COMMIT;
