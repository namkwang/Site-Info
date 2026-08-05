-- 019: 자격증명을 우리 스키마로 — 로그인까지 site_info 가 담당한다
--
-- 배경: 사용자 관리(누구인지·권한·승인)는 이미 site_info.user_profile 이
--   소유하지만, 비밀번호 검증은 Supabase Auth(auth.users)가 하고 있었다.
--   auth 는 프로젝트당 하나뿐이라 팀 프로젝트를 쓰는 모든 서비스가 공유하고,
--   그래서 우리 사용자 중 4명은 이미 조직 계정을 갖고 있어 비밀번호가 우리
--   통제를 벗어나 있었다. 계정을 우리가 통제하기로 결정 → 자격증명도 옮긴다.
--
-- 이후 auth.users 는 우리 앱에서 쓰지 않는다. user_profile.id 는 계속 UUID 지만
-- 더 이상 auth 계정을 가리키지 않는 우리 고유 식별자가 된다.
--
-- 해시는 bcrypt 를 쓴다. Supabase 가 쓰던 것과 같은 방식($2a$)이라, 기존 해시를
-- 읽어올 수 있으면 그대로 넣어 사용자가 같은 비밀번호를 계속 쓸 수 있다.

BEGIN;

-- id 는 원래 auth.users(id) 를 그대로 받는 컬럼이라 기본값이 없었다. 이제
-- 계정을 우리가 만들므로 우리가 생성해야 한다.
ALTER TABLE site_info.user_profile
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS site_info.user_credential (
  user_id             UUID PRIMARY KEY,   -- user_profile.id (FK 는 걸지 않는다)
  password_hash       TEXT NOT NULL,      -- bcrypt
  -- 로그인 시도 제한. 무제한 대입을 막는 최소 장치이며, 계정 단위로 센다.
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  -- 관리자가 지정한 초기 비밀번호는 첫 로그인 후 바꾸게 한다.
  must_change         BOOLEAN NOT NULL DEFAULT FALSE,
  -- 이 시각 이전에 발급된 토큰은 무효로 본다(비밀번호 변경 = 전체 로그아웃).
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID,
  updated_by          UUID
);

DROP TRIGGER IF EXISTS trg_user_credential_updated_at ON site_info.user_credential;
CREATE TRIGGER trg_user_credential_updated_at
  BEFORE UPDATE ON site_info.user_credential
  FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();

-- 해시는 어떤 사용자에게도 노출되지 않아야 한다. RLS 를 켜고 정책을 하나도
-- 만들지 않으면 authenticated/anon 은 0행을 보고, service_role(백엔드)만
-- 접근한다. GRANT 도 주지 않는다.
ALTER TABLE site_info.user_credential ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON site_info.user_credential FROM anon, authenticated;
GRANT ALL ON site_info.user_credential TO service_role;

COMMIT;
