-- 024: SSO 티켓에 부서 — 포털이 보내면 그대로 받는다
--
-- 배경: 티켓 발급 요청 모델이 employee_no / role / name 만 정의해서, 포털이
--   부서를 보내더라도 pydantic 이 **조용히 버렸다.** 명세 예시에만 없었을 뿐
--   실제로는 올 수 있는데, 버려지면 무엇이 오는지 확인할 방법조차 없다.
--
--   이제 모르는 필드까지 받아 두고(extra="allow") 부서가 오면 그대로 쓴다.
--   티켓은 발급과 사용이 분리돼 있으므로, 발급 때 받은 부서를 사용 시점까지
--   들고 가려면 여기에 담아야 한다.
--
-- 부서가 오지 않으면 지금처럼 portal.portal_users 에서 찾는다. 즉 포털이
-- 보내주면 다른 스키마 조회를 아끼고, 안 보내줘도 동작은 같다.

BEGIN;

ALTER TABLE site_info.sso_ticket
  ADD COLUMN IF NOT EXISTS department TEXT;

COMMIT;
