-- 020: 롤을 viewer / admin 둘로 정리한다
--
-- 배경: role CHECK 에는 'user', 'executive', 'admin' 셋이 있었지만 실제로
--   구분되는 건 admin 뿐이다. 백엔드는 require_admin(role == 'admin') 하나로
--   쓰기를 막고, 'executive' 는 어느 코드에도 분기가 없어 'user' 와 완전히
--   같게 동작했다 — 프론트 타입(auth-context.tsx)은 아예 존재를 몰랐다.
--   있지도 않은 등급을 CHECK 이 허용하고 있으면, 부여한 사람은 권한을 준 줄
--   알지만 실제로는 아무것도 바뀌지 않는다.
--
-- 정리:
--   admin  — 전체 권한 (사용자 관리·현장·조직도·관리주체·지오코딩 쓰기)
--   viewer — 조회 전용. 쓰기 엔드포인트는 전부 require_admin 이 막는다.
--
-- 'user' 대신 'viewer' 를 쓰는 이유: 'user' 는 "권한 없음"이 아니라 그냥
-- "사용자"로 읽혀서, 조회 전용이라는 사실이 이름에 드러나지 않는다.
--
-- 기존 행: 'user' 와 'executive' 를 모두 'viewer' 로 옮긴다. 권한이 줄어드는
-- 사람은 없다 — executive 는 이미 user 와 동일하게 동작하고 있었다.

BEGIN;

-- CHECK 을 먼저 푼다. 그러지 않으면 아래 UPDATE 가 새 값에서 걸린다.
ALTER TABLE site_info.user_profile
  DROP CONSTRAINT IF EXISTS user_profile_role_check;

UPDATE site_info.user_profile
   SET role = 'viewer'
 WHERE role IN ('user', 'executive');

ALTER TABLE site_info.user_profile
  ALTER COLUMN role SET DEFAULT 'viewer';

ALTER TABLE site_info.user_profile
  ADD CONSTRAINT user_profile_role_check
  CHECK (role = ANY (ARRAY['viewer'::text, 'admin'::text]));

COMMIT;
