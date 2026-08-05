-- 021: anon / authenticated 권한 회수 — 조직 전체에 열려 있던 조회를 닫는다
--
-- 문제(실측 2026-08-05): 팀 프로젝트의 `authenticated` 는 조직의 모든 서비스
--   사용자다(공개 anon 키 + 각자의 Supabase 세션). 그 롤로 우리 데이터가
--   그대로 읽혔다 — 테이블·뷰 14개:
--     project_site 118행(계약금액 포함), user_profile 22행(이메일·사번),
--     site_org_member 253행 / v_site_org_chart 148행(이름·전화·주소·생년월일),
--     site_department 630, jv_participation 278, 참조 마스터 전부.
--   쓰기는 막혀 있었지만 읽기는 전면 개방이었다.
--
-- 원인: 003 세대의 `FOR ALL USING (true)` 정책이 남아 012 의 approved_select 와
--   OR 로 합쳐져 조건을 무력화했고, 테이블 GRANT 도 authenticated 에 열려 있었다.
--   개인 프로젝트에서는 authenticated == 우리 사용자였으니 문제가 아니었는데,
--   팀 프로젝트로 옮기면서 그 전제가 깨졌다.
--
-- 해결: 정책을 손보는 대신 **권한을 아예 회수한다.** 자체 인증으로 전환한 뒤
--   브라우저는 DB 를 직접 조회하지 않는다(모든 조회가 백엔드 경유, 커밋 771b260).
--   우리 토큰은 Supabase 가 발급한 것이 아니라 authenticated 롤로 인식되지도
--   않는다. 즉 이 두 롤은 우리 스키마에 접근할 이유가 없다.
--   백엔드는 service_role 로 붙으므로 영향이 없다.
--
-- 정책도 함께 정리한다. 권한이 없으면 정책은 도달하지 않지만, USING (true) 가
-- 남아 있으면 나중에 누가 GRANT 를 되살릴 때 곧바로 다시 열린다.

BEGIN;

-- ── 1) 권한 회수 ──────────────────────────────────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA site_info FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA site_info FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA site_info FROM anon, authenticated;
REVOKE USAGE ON SCHEMA site_info FROM anon, authenticated;

-- 앞으로 만드는 테이블이 자동으로 다시 열리지 않게 한다. Supabase 는 기본
-- 권한으로 anon/authenticated 에 부여하도록 설정해 두므로 이걸 빼지 않으면
-- 다음에 테이블을 만들 때 조용히 다시 노출된다.
ALTER DEFAULT PRIVILEGES IN SCHEMA site_info
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA site_info
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA site_info
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 백엔드가 쓰는 롤은 명시적으로 확정해 둔다(회수에 휩쓸리지 않게).
GRANT USAGE ON SCHEMA site_info TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA site_info TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA site_info TO service_role;

-- ── 2) 조건 없는 정책 제거 ────────────────────────────────
-- 003 세대의 "Allow full access" 류. 이름이 테이블마다 같아 일괄 처리한다.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname, tablename
      FROM pg_policies
     WHERE schemaname = 'site_info'
       AND (qual IS NULL OR btrim(qual) = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON site_info.%I', p.policyname, p.tablename);
    RAISE NOTICE '조건 없는 정책 제거: %.%', p.tablename, p.policyname;
  END LOOP;
END $$;

COMMIT;
