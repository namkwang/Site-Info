-- 018: 감사 컬럼 (created_by / updated_by / updated_at)
--
-- 배경: 팀 운영 프로젝트의 모든 테이블은 예외 없이
--   created_by / created_at / updated_by / updated_at + is_active 규약을 따른다.
--   우리 테이블은 created_at 만 있어 "누가 바꿨는지"가 남지 않는다. 개인
--   프로젝트에서는 사용자가 나 혼자라 문제가 없었지만, 여러 팀이 같은 DB를
--   보는 환경에서는 변경 추적이 안 되는 것 자체가 운영 리스크다.
--
-- 대상: 앱이 실제로 INSERT/UPDATE 하는 테이블만. 참조 마스터
--   (corporation / region_code / facility_type / org_role) 는 값이 고정이고
--   앱에서 바꾸지 않으므로 넣지 않는다 — 안 채워질 컬럼을 만들지 않는다.
--
-- 타입은 UUID (user_profile.id = auth 사용자 UUID). FK 는 걸지 않는다 —
-- 016 에서 auth 스키마 의존을 끊은 것과 같은 이유이고, 사용자가 삭제돼도
-- 감사 기록은 남아야 한다.

BEGIN;

ALTER TABLE pmis.project_site
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE pmis.site_org_member
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE pmis.site_department
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE pmis.managing_entity
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE pmis.jv_participation
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE pmis.site_memo
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- updated_at 을 앱이 잊어도 항상 정확하게: 기존 pmis.touch_updated_at() 재사용
-- (007 에서 user_profile 용으로 만들어 둔 것)
DROP TRIGGER IF EXISTS trg_project_site_updated_at ON pmis.project_site;
CREATE TRIGGER trg_project_site_updated_at
  BEFORE UPDATE ON pmis.project_site
  FOR EACH ROW EXECUTE FUNCTION pmis.touch_updated_at();

DROP TRIGGER IF EXISTS trg_site_org_member_updated_at ON pmis.site_org_member;
CREATE TRIGGER trg_site_org_member_updated_at
  BEFORE UPDATE ON pmis.site_org_member
  FOR EACH ROW EXECUTE FUNCTION pmis.touch_updated_at();

DROP TRIGGER IF EXISTS trg_site_department_updated_at ON pmis.site_department;
CREATE TRIGGER trg_site_department_updated_at
  BEFORE UPDATE ON pmis.site_department
  FOR EACH ROW EXECUTE FUNCTION pmis.touch_updated_at();

DROP TRIGGER IF EXISTS trg_managing_entity_updated_at ON pmis.managing_entity;
CREATE TRIGGER trg_managing_entity_updated_at
  BEFORE UPDATE ON pmis.managing_entity
  FOR EACH ROW EXECUTE FUNCTION pmis.touch_updated_at();

DROP TRIGGER IF EXISTS trg_jv_participation_updated_at ON pmis.jv_participation;
CREATE TRIGGER trg_jv_participation_updated_at
  BEFORE UPDATE ON pmis.jv_participation
  FOR EACH ROW EXECUTE FUNCTION pmis.touch_updated_at();

DROP TRIGGER IF EXISTS trg_site_memo_updated_at ON pmis.site_memo;
CREATE TRIGGER trg_site_memo_updated_at
  BEFORE UPDATE ON pmis.site_memo
  FOR EACH ROW EXECUTE FUNCTION pmis.touch_updated_at();

COMMIT;
