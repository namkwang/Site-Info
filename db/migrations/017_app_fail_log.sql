-- 017: 삼켜지는 실패를 DB에 남긴다
--
-- 배경: 지금은 부가 작업 실패를 print("[WARN] …") 로만 남긴다(사진 URL 저장,
--   기본 부서 시드, 관리부서 조회 등). 컨테이너를 재시작하면 사라져서
--   "사진이 안 보인다" 같은 제보를 받아도 원인을 추적할 수 없다.
--   팀 운영 프로젝트의 common.c_sync_fail_log 와 같은 방식으로 DB에 남긴다.
--
-- 컬럼 이름은 c_sync_fail_log 규약을 그대로 따랐다 (target / source_key /
-- error_message / raw_data / created_at). run_id 는 우리에게 배치 개념이
-- 없어 제외하고, 대신 누가 유발했는지 추적할 actor_id 를 둔다.

BEGIN;

CREATE TABLE IF NOT EXISTS pmis.app_fail_log (
  fail_id       BIGSERIAL PRIMARY KEY,
  target        VARCHAR(80) NOT NULL,   -- 실패한 작업. 예: org.photo_url_persist
  source_key    VARCHAR(120),           -- 대상 식별자. 예: member_id / site_id
  error_message TEXT,
  raw_data      JSONB,                  -- 재현에 필요한 최소 맥락
  actor_id      UUID,                   -- 유발한 사용자 (user_profile.id, FK 없음)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 조회는 사실상 "최근 것부터" 또는 "이 작업의 최근 실패" 두 가지뿐이다.
CREATE INDEX IF NOT EXISTS idx_app_fail_log_created
  ON pmis.app_fail_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_fail_log_target
  ON pmis.app_fail_log (target, created_at DESC);

-- 로그에 오류 메시지·맥락이 담기므로 일반 사용자에게 열지 않는다.
-- 백엔드는 service_role 로 붙어 RLS를 우회하므로 정책 없이도 기록된다.
-- anon 에는 아무 권한도 주지 않는다(팀 프로젝트의 공개 anon 키 정책에 맞춤).
ALTER TABLE pmis.app_fail_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select ON pmis.app_fail_log;
CREATE POLICY admin_select ON pmis.app_fail_log
  FOR SELECT TO authenticated
  USING (pmis.is_admin());

COMMIT;
