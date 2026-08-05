-- 023: 사용자 부서 — SSO 사용자를 "이름 · 부서"로 표시하기 위해
--
-- 배경: 포털 SSO 로 들어온 사용자는 화면에 `21226064@sso.local` 로 보였다.
--   포털이 보내는 payload 에는 employee_no / role / name 만 있고 이메일이 없어
--   자리표시자 주소를 만들어 넣기 때문이다. 이름과 부서를 채워 포털과 같은
--   형식(`배수연 · AX팀`)으로 보이게 한다.
--
-- 부서는 포털이 이미 관리한다(portal.portal_users 에 emp_no / name / dept).
-- 우리가 그 값을 복사해 두는 이유:
--   - 매 화면마다 다른 스키마를 조회하면 결합이 생기고 느려진다. 로그인 시점에
--     한 번 받아 우리 테이블에 둔다.
--   - 포털 쪽 접근이 막히거나 사람이 포털에서 사라져도 화면이 깨지지 않는다.
--   값이 바뀌면 다음 SSO 로그인 때 갱신된다.

BEGIN;

ALTER TABLE site_info.user_profile
  ADD COLUMN IF NOT EXISTS department TEXT;

COMMIT;
