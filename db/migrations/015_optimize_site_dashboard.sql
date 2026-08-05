-- 015: v_site_dashboard 조회 성능 개선
--
-- 문제: 대시보드 목록 조회(전체 현장 SELECT)가 0.5~2.3초. 뷰가 현장(행)마다
--   site_org_member를 뒤지는 상관 서브쿼리를 4개 실행한다 —
--   headcount 1개 + 현장소장 name/rank/phone 각 1개(같은 행을 세 번 조회).
--
-- 조치:
--   1) 현장소장 서브쿼리 3개를 LEFT JOIN LATERAL 1개로 통합 (행당 스캔 3회 → 1회)
--   2) 서브쿼리가 타는 인덱스 추가 (site_org_member / jv_participation / site_memo)
--
-- 컬럼 목록·순서·타입은 014와 동일하다 — API/프론트 스키마 영향 없음.

BEGIN;

-- headcount·현장소장 lookup 공용. is_active 부분 인덱스로 소프트삭제 행 제외.
CREATE INDEX IF NOT EXISTS idx_site_org_member_site_active
  ON pmis.site_org_member (site_id, role_id, sort_order, id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_jv_participation_site
  ON pmis.jv_participation (site_id);

CREATE INDEX IF NOT EXISTS idx_site_memo_site_active_date
  ON pmis.site_memo (site_id, memo_date DESC)
  WHERE is_active;

DROP VIEW IF EXISTS pmis.v_site_dashboard;

CREATE VIEW pmis.v_site_dashboard AS
SELECT
  ps.id,
  ps.name AS site_name,
  c.name AS corporation_name,
  c.code AS corporation_code,
  ps.division,
  ps.category,
  rc.name AS region_name,
  rc.region_group,
  ft.name AS facility_type_name,
  ps.order_type,
  co.name AS client_name,
  ps.contract_amount,
  ps.our_share_amount,
  ps.execution_rate,
  ps.execution_status,
  ps.execution_note,
  ps.progress_rate,
  ps.progress_note,
  ps.start_date,
  ps.end_date,
  (SELECT COUNT(*)::int
     FROM pmis.site_org_member m
    WHERE m.site_id = ps.id AND m.is_active = TRUE
  ) AS headcount,
  ps.office_address,
  -- 현장소장: 조직도에서 SITE_MANAGER role active 멤버 (LATERAL 1회로 통합)
  mgr.name AS site_manager,
  mgr.rank AS manager_position,
  mgr.phone AS manager_phone,
  -- PM: project_site의 텍스트 컬럼에서 직접 (조직도 join 없음)
  ps.pm_name,
  NULL::text AS pm_position,
  ps.status,
  ps.risk_grade,
  ps.delay_days,
  (SELECT string_agg(((pc.name || ' '::text) || jp.share_pct) || '%'::text, ', '::text ORDER BY jp.display_order)
     FROM pmis.jv_participation jp
     JOIN pmis.partner_company pc ON pc.id = jp.partner_id
    WHERE jp.site_id = ps.id
  ) AS jv_summary,
  (SELECT sm.content
     FROM pmis.site_memo sm
    WHERE sm.site_id = ps.id AND sm.is_active = TRUE
    ORDER BY sm.memo_date DESC LIMIT 1
  ) AS latest_memo
FROM pmis.project_site ps
LEFT JOIN pmis.corporation c ON c.id = ps.corporation_id
LEFT JOIN pmis.region_code rc ON rc.code = ps.region_code
LEFT JOIN pmis.facility_type ft ON ft.code = ps.facility_type_code
LEFT JOIN pmis.client_org co ON co.id = ps.client_org_id
LEFT JOIN LATERAL (
  SELECT m.name, m.rank, m.phone
    FROM pmis.site_org_member m
    JOIN pmis.org_role r ON r.id = m.role_id
   WHERE m.site_id = ps.id AND m.is_active = TRUE AND r.code = 'SITE_MANAGER'
   ORDER BY m.sort_order, m.id
   LIMIT 1
) mgr ON TRUE;

-- Keep migration 012's invoker setting (view was just re-created so it defaults to definer)
ALTER VIEW pmis.v_site_dashboard SET (security_invoker = true);

COMMIT;
