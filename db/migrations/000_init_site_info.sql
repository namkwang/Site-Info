-- site_info 스키마 DDL — mpoufkwszfihkufkundx 의 pmis 에서 실측 추출
-- scripts/dump_schema.py 생성물. 커밋 전 확인 필요 (특히 GRANT/RLS).
-- 제외한 테이블: progress_snapshot, site_media, site_milestone, site_personnel, site_spec, site_visit

BEGIN;

-- 스키마는 이미 존재해야 한다. CREATE SCHEMA 를 일부러 넣지 않는다 —
-- 팀 공용 프로젝트에서는 스키마 생성·변경을 우리가 하지 않는 것이 원칙이다.
-- (없으면 아래 문장들이 실패하므로 잘못된 대상에 적용되는 사고를 막아준다)

-- ═══ 시퀀스 ═══
CREATE SEQUENCE IF NOT EXISTS site_info.app_fail_log_fail_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.client_org_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.corporation_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.jv_participation_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.managing_entity_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.org_role_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.partner_company_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.project_site_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.site_department_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.site_memo_id_seq;
CREATE SEQUENCE IF NOT EXISTS site_info.site_org_member_id_seq;

-- ═══ 테이블 ═══

CREATE TABLE IF NOT EXISTS site_info.app_fail_log (
  fail_id bigint DEFAULT nextval('site_info.app_fail_log_fail_id_seq'::regclass) NOT NULL,
  target character varying(80) NOT NULL,
  source_key character varying(120),
  error_message text,
  raw_data jsonb,
  actor_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT app_fail_log_pkey PRIMARY KEY (fail_id)
);

CREATE TABLE IF NOT EXISTS site_info.client_org (
  id integer DEFAULT nextval('site_info.client_org_id_seq'::regclass) NOT NULL,
  name text NOT NULL,
  org_type text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT client_org_pkey PRIMARY KEY (id),
  CONSTRAINT client_org_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS site_info.corporation (
  id integer DEFAULT nextval('site_info.corporation_id_seq'::regclass) NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT corporation_pkey PRIMARY KEY (id),
  CONSTRAINT corporation_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS site_info.facility_type (
  code text NOT NULL,
  name text NOT NULL,
  division text,
  CONSTRAINT facility_type_pkey PRIMARY KEY (code),
  CONSTRAINT facility_type_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS site_info.jv_participation (
  id integer DEFAULT nextval('site_info.jv_participation_id_seq'::regclass) NOT NULL,
  site_id integer NOT NULL,
  partner_id integer NOT NULL,
  share_pct numeric(5,2) NOT NULL,
  is_lead boolean DEFAULT false,
  contract_type text DEFAULT 'MAIN'::text,
  display_order smallint DEFAULT 0,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT jv_participation_pkey PRIMARY KEY (id),
  CONSTRAINT jv_participation_site_id_partner_id_key UNIQUE (site_id, partner_id),
  CONSTRAINT jv_participation_share_pct_check CHECK (((share_pct > (0)::numeric) AND (share_pct <= (100)::numeric)))
);

CREATE TABLE IF NOT EXISTS site_info.managing_entity (
  id integer DEFAULT nextval('site_info.managing_entity_id_seq'::regclass) NOT NULL,
  corporation_id integer NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT managing_entity_pkey PRIMARY KEY (id),
  CONSTRAINT managing_entity_corporation_id_name_key UNIQUE (corporation_id, name)
);

CREATE TABLE IF NOT EXISTS site_info.org_role (
  id integer DEFAULT nextval('site_info.org_role_id_seq'::regclass) NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT org_role_pkey PRIMARY KEY (id),
  CONSTRAINT org_role_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS site_info.partner_company (
  id integer DEFAULT nextval('site_info.partner_company_id_seq'::regclass) NOT NULL,
  name text NOT NULL,
  is_group_member boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT partner_company_pkey PRIMARY KEY (id),
  CONSTRAINT partner_company_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS site_info.project_site (
  id integer DEFAULT nextval('site_info.project_site_id_seq'::regclass) NOT NULL,
  corporation_id integer NOT NULL,
  name text NOT NULL,
  division text NOT NULL,
  category text DEFAULT '주간'::text NOT NULL,
  region_code text,
  facility_type_code text,
  order_type text,
  client_org_id integer,
  contract_amount numeric(15,2),
  our_share_amount numeric(15,2),
  original_contract_amount numeric(15,2),
  execution_rate numeric(6,4),
  execution_status text DEFAULT 'CONFIRMED'::text,
  execution_note text,
  progress_rate numeric(6,4),
  progress_note text,
  planned_progress_rate numeric(6,4),
  budget_amount numeric(15,2),
  start_date date,
  end_date date,
  original_end_date date,
  actual_end_date date,
  date_note text,
  office_address text,
  site_address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  status text DEFAULT 'ACTIVE'::text,
  risk_grade text DEFAULT 'B'::text,
  delay_days integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status_manual boolean DEFAULT false NOT NULL,
  required_headcount jsonb DEFAULT '{}'::jsonb NOT NULL,
  managing_entity_id integer,
  pm_name text,
  created_by uuid,
  updated_by uuid,
  CONSTRAINT project_site_pkey PRIMARY KEY (id),
  CONSTRAINT project_site_category_check CHECK ((category = ANY (ARRAY['주간'::text, '비주간'::text]))),
  CONSTRAINT project_site_division_check CHECK ((division = ANY (ARRAY['토목'::text, '건축'::text]))),
  CONSTRAINT project_site_risk_grade_check CHECK ((risk_grade = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text]))),
  CONSTRAINT project_site_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'COMPLETED'::text, 'SUSPENDED'::text, 'EXCLUDED'::text, 'PRE_START'::text])))
);

CREATE TABLE IF NOT EXISTS site_info.region_code (
  code text NOT NULL,
  name text NOT NULL,
  region_group text,
  CONSTRAINT region_code_pkey PRIMARY KEY (code),
  CONSTRAINT region_code_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS site_info.site_department (
  id integer DEFAULT nextval('site_info.site_department_id_seq'::regclass) NOT NULL,
  site_id integer NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT site_department_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS site_info.site_memo (
  id integer DEFAULT nextval('site_info.site_memo_id_seq'::regclass) NOT NULL,
  site_id integer NOT NULL,
  memo_type text DEFAULT 'GENERAL'::text NOT NULL,
  content text NOT NULL,
  memo_date date DEFAULT CURRENT_DATE NOT NULL,
  is_active boolean DEFAULT true,
  priority text DEFAULT 'NORMAL'::text,
  visibility text DEFAULT 'ALL'::text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT site_memo_pkey PRIMARY KEY (id),
  CONSTRAINT site_memo_priority_check CHECK ((priority = ANY (ARRAY['URGENT'::text, 'NORMAL'::text, 'FYI'::text]))),
  CONSTRAINT site_memo_visibility_check CHECK ((visibility = ANY (ARRAY['EXECUTIVE'::text, 'INTERNAL'::text, 'ALL'::text])))
);

CREATE TABLE IF NOT EXISTS site_info.site_org_member (
  id integer DEFAULT nextval('site_info.site_org_member_id_seq'::regclass) NOT NULL,
  site_id integer NOT NULL,
  name text NOT NULL,
  rank text,
  phone text,
  email text,
  org_type text DEFAULT 'OWN'::text NOT NULL,
  company_name text,
  employee_type text DEFAULT '일반직'::text,
  role_id integer NOT NULL,
  department_id integer,
  specialty text,
  parent_id integer,
  sort_order integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  assigned_from date,
  assigned_to date,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  birth_date text,
  address text,
  phone_work text,
  photo_url text,
  job_category text,
  skills text,
  hobby text,
  entry_type text,
  task_detail text,
  resume_data jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  CONSTRAINT site_org_member_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS site_info.user_profile (
  id uuid NOT NULL,
  email text NOT NULL,
  full_name text DEFAULT ''::text NOT NULL,
  employee_number text,
  corporation_id integer,
  role text DEFAULT 'user'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  approved_at timestamp with time zone,
  approved_by uuid,
  reject_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_profile_pkey PRIMARY KEY (id),
  CONSTRAINT user_profile_email_key UNIQUE (email),
  CONSTRAINT user_profile_role_check CHECK ((role = ANY (ARRAY['user'::text, 'executive'::text, 'admin'::text]))),
  CONSTRAINT user_profile_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

-- 시퀀스 소유권 (테이블과 생명주기를 묶는다)
ALTER SEQUENCE site_info.app_fail_log_fail_id_seq OWNED BY site_info.app_fail_log.fail_id;
ALTER SEQUENCE site_info.client_org_id_seq OWNED BY site_info.client_org.id;
ALTER SEQUENCE site_info.corporation_id_seq OWNED BY site_info.corporation.id;
ALTER SEQUENCE site_info.jv_participation_id_seq OWNED BY site_info.jv_participation.id;
ALTER SEQUENCE site_info.managing_entity_id_seq OWNED BY site_info.managing_entity.id;
ALTER SEQUENCE site_info.org_role_id_seq OWNED BY site_info.org_role.id;
ALTER SEQUENCE site_info.partner_company_id_seq OWNED BY site_info.partner_company.id;
ALTER SEQUENCE site_info.project_site_id_seq OWNED BY site_info.project_site.id;
ALTER SEQUENCE site_info.site_department_id_seq OWNED BY site_info.site_department.id;
ALTER SEQUENCE site_info.site_memo_id_seq OWNED BY site_info.site_memo.id;
ALTER SEQUENCE site_info.site_org_member_id_seq OWNED BY site_info.site_org_member.id;

-- ═══ 외래키 (테이블 생성 순서에 의존하지 않도록 분리) ═══
ALTER TABLE site_info.jv_participation ADD CONSTRAINT jv_participation_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES site_info.partner_company(id);
ALTER TABLE site_info.jv_participation ADD CONSTRAINT jv_participation_site_id_fkey FOREIGN KEY (site_id) REFERENCES site_info.project_site(id) ON DELETE CASCADE;
ALTER TABLE site_info.managing_entity ADD CONSTRAINT managing_entity_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES site_info.corporation(id) ON DELETE CASCADE;
ALTER TABLE site_info.project_site ADD CONSTRAINT project_site_client_org_id_fkey FOREIGN KEY (client_org_id) REFERENCES site_info.client_org(id);
ALTER TABLE site_info.project_site ADD CONSTRAINT project_site_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES site_info.corporation(id);
ALTER TABLE site_info.project_site ADD CONSTRAINT project_site_facility_type_code_fkey FOREIGN KEY (facility_type_code) REFERENCES site_info.facility_type(code);
ALTER TABLE site_info.project_site ADD CONSTRAINT project_site_managing_entity_id_fkey FOREIGN KEY (managing_entity_id) REFERENCES site_info.managing_entity(id) ON DELETE SET NULL;
ALTER TABLE site_info.project_site ADD CONSTRAINT project_site_region_code_fkey FOREIGN KEY (region_code) REFERENCES site_info.region_code(code);
ALTER TABLE site_info.site_memo ADD CONSTRAINT site_memo_site_id_fkey FOREIGN KEY (site_id) REFERENCES site_info.project_site(id) ON DELETE CASCADE;
ALTER TABLE site_info.site_org_member ADD CONSTRAINT site_org_member_department_id_fkey FOREIGN KEY (department_id) REFERENCES site_info.site_department(id);
ALTER TABLE site_info.site_org_member ADD CONSTRAINT site_org_member_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES site_info.site_org_member(id) ON DELETE SET NULL;
ALTER TABLE site_info.site_org_member ADD CONSTRAINT site_org_member_role_id_fkey FOREIGN KEY (role_id) REFERENCES site_info.org_role(id);
ALTER TABLE site_info.user_profile ADD CONSTRAINT user_profile_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES site_info.corporation(id);

-- ═══ 인덱스 ═══
CREATE INDEX idx_app_fail_log_created ON site_info.app_fail_log USING btree (created_at DESC);
CREATE INDEX idx_app_fail_log_target ON site_info.app_fail_log USING btree (target, created_at DESC);
CREATE INDEX idx_jv_participation_site ON site_info.jv_participation USING btree (site_id);
CREATE INDEX idx_jv_partner ON site_info.jv_participation USING btree (partner_id);
CREATE INDEX idx_jv_site ON site_info.jv_participation USING btree (site_id);
CREATE INDEX idx_managing_entity_corp ON site_info.managing_entity USING btree (corporation_id);
CREATE INDEX idx_project_site_managing_entity ON site_info.project_site USING btree (managing_entity_id);
CREATE INDEX idx_project_site_status_manual ON site_info.project_site USING btree (status_manual) WHERE (status_manual = true);
CREATE INDEX idx_site_corp ON site_info.project_site USING btree (corporation_id);
CREATE INDEX idx_site_corp_div_status ON site_info.project_site USING btree (corporation_id, division, status);
CREATE INDEX idx_site_facility ON site_info.project_site USING btree (facility_type_code);
CREATE INDEX idx_site_region ON site_info.project_site USING btree (region_code);
CREATE INDEX idx_site_risk ON site_info.project_site USING btree (risk_grade) WHERE (status = 'ACTIVE'::text);
CREATE INDEX idx_site_status ON site_info.project_site USING btree (status);
CREATE INDEX idx_memo_active ON site_info.site_memo USING btree (site_id, is_active) WHERE (is_active = true);
CREATE INDEX idx_memo_site ON site_info.site_memo USING btree (site_id);
CREATE INDEX idx_site_memo_site_active_date ON site_info.site_memo USING btree (site_id, memo_date DESC) WHERE is_active;
CREATE INDEX idx_site_org_member_active ON site_info.site_org_member USING btree (site_id, is_active) WHERE (is_active = true);
CREATE INDEX idx_site_org_member_dept ON site_info.site_org_member USING btree (department_id);
CREATE INDEX idx_site_org_member_parent ON site_info.site_org_member USING btree (parent_id);
CREATE INDEX idx_site_org_member_site ON site_info.site_org_member USING btree (site_id);
CREATE INDEX idx_site_org_member_site_active ON site_info.site_org_member USING btree (site_id, role_id, sort_order, id) WHERE is_active;
CREATE INDEX idx_user_profile_corp ON site_info.user_profile USING btree (corporation_id);
CREATE INDEX idx_user_profile_status ON site_info.user_profile USING btree (status);

-- ═══ 함수 ═══

CREATE OR REPLACE FUNCTION site_info.check_managing_entity_corp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  entity_corp_id INTEGER;
BEGIN
  IF NEW.managing_entity_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT corporation_id INTO entity_corp_id
    FROM site_info.managing_entity
   WHERE id = NEW.managing_entity_id;
  IF entity_corp_id IS NULL THEN
    RAISE EXCEPTION '관리주체(id=%)를 찾을 수 없습니다', NEW.managing_entity_id;
  END IF;
  IF entity_corp_id <> NEW.corporation_id THEN
    RAISE EXCEPTION '관리주체의 법인이 현장 법인과 일치해야 합니다 (현장=%, 주체=%)',
      NEW.corporation_id, entity_corp_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION site_info."current_role"()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'site_info', 'public'
AS $function$
  SELECT role FROM site_info.user_profile
  WHERE id = auth.uid() AND status = 'approved'
$function$;

CREATE OR REPLACE FUNCTION site_info.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(site_info.current_role() = 'admin', FALSE)
$function$;

CREATE OR REPLACE FUNCTION site_info.is_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'site_info', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM site_info.user_profile
    WHERE id = auth.uid() AND status = 'approved'
  )
$function$;

CREATE OR REPLACE FUNCTION site_info.is_approved_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'site_info'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM site_info.user_profile
     WHERE id = auth.uid()
       AND status = 'approved'
  );
$function$;

CREATE OR REPLACE FUNCTION site_info.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ═══ 뷰 ═══

CREATE OR REPLACE VIEW site_info.v_site_dashboard AS
 SELECT ps.id,
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
    ( SELECT count(*)::integer AS count
           FROM site_info.site_org_member m
          WHERE m.site_id = ps.id AND m.is_active = true) AS headcount,
    ps.office_address,
    mgr.name AS site_manager,
    mgr.rank AS manager_position,
    mgr.phone AS manager_phone,
    ps.pm_name,
    NULL::text AS pm_position,
    ps.status,
    ps.risk_grade,
    ps.delay_days,
    ( SELECT string_agg(((pc.name || ' '::text) || jp.share_pct) || '%'::text, ', '::text ORDER BY jp.display_order) AS string_agg
           FROM site_info.jv_participation jp
             JOIN site_info.partner_company pc ON pc.id = jp.partner_id
          WHERE jp.site_id = ps.id) AS jv_summary,
    ( SELECT sm.content
           FROM site_info.site_memo sm
          WHERE sm.site_id = ps.id AND sm.is_active = true
          ORDER BY sm.memo_date DESC
         LIMIT 1) AS latest_memo
   FROM site_info.project_site ps
     LEFT JOIN site_info.corporation c ON c.id = ps.corporation_id
     LEFT JOIN site_info.region_code rc ON rc.code = ps.region_code
     LEFT JOIN site_info.facility_type ft ON ft.code = ps.facility_type_code
     LEFT JOIN site_info.client_org co ON co.id = ps.client_org_id
     LEFT JOIN LATERAL ( SELECT m.name,
            m.rank,
            m.phone
           FROM site_info.site_org_member m
             JOIN site_info.org_role r ON r.id = m.role_id
          WHERE m.site_id = ps.id AND m.is_active = true AND r.code = 'SITE_MANAGER'::text
          ORDER BY m.sort_order, m.id
         LIMIT 1) mgr ON true;
ALTER VIEW site_info.v_site_dashboard SET (security_invoker = true);

CREATE OR REPLACE VIEW site_info.v_site_org_chart AS
 SELECT m.id,
    m.site_id,
    m.name,
    m.rank,
    m.phone,
    m.email,
    m.org_type,
    m.company_name,
    m.employee_type,
    m.role_id,
    r.code AS role_code,
    r.name AS role_name,
    r.sort_order AS role_sort_order,
    m.department_id,
    d.name AS department_name,
    d.sort_order AS department_sort_order,
    m.specialty,
    m.parent_id,
    m.sort_order,
    m.is_active,
    m.assigned_from,
    m.assigned_to,
    m.note,
    m.birth_date,
    m.address,
    m.phone_work,
    m.photo_url,
    m.job_category,
    m.skills,
    m.hobby,
    m.entry_type,
    m.task_detail,
    m.resume_data
   FROM site_info.site_org_member m
     LEFT JOIN site_info.org_role r ON r.id = m.role_id
     LEFT JOIN site_info.site_department d ON d.id = m.department_id
  WHERE m.is_active = true;
ALTER VIEW site_info.v_site_org_chart SET (security_invoker = true);

-- ═══ 트리거 ═══
CREATE TRIGGER trg_jv_participation_updated_at BEFORE UPDATE ON site_info.jv_participation FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();
CREATE TRIGGER trg_managing_entity_updated_at BEFORE UPDATE ON site_info.managing_entity FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();
CREATE TRIGGER trg_check_managing_entity_corp BEFORE INSERT OR UPDATE OF managing_entity_id, corporation_id ON site_info.project_site FOR EACH ROW EXECUTE FUNCTION site_info.check_managing_entity_corp();
CREATE TRIGGER trg_project_site_updated_at BEFORE UPDATE ON site_info.project_site FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();
CREATE TRIGGER trg_site_department_updated_at BEFORE UPDATE ON site_info.site_department FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();
CREATE TRIGGER trg_site_memo_updated_at BEFORE UPDATE ON site_info.site_memo FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();
CREATE TRIGGER trg_site_org_member_updated_at BEFORE UPDATE ON site_info.site_org_member FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();
CREATE TRIGGER trg_user_profile_updated_at BEFORE UPDATE ON site_info.user_profile FOR EACH ROW EXECUTE FUNCTION site_info.touch_updated_at();

-- ═══ RLS ═══
ALTER TABLE site_info.app_fail_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.client_org ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.corporation ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.facility_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.jv_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.managing_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.org_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.partner_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.project_site ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.region_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.site_department ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.site_memo ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.site_org_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_info.user_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select ON site_info.app_fail_log;
CREATE POLICY admin_select ON site_info.app_fail_log FOR SELECT TO authenticated
  USING (site_info.is_admin());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.client_org;
CREATE POLICY "Authenticated insert" ON site_info.client_org FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.client_org;
CREATE POLICY "Authenticated read" ON site_info.client_org FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.client_org;
CREATE POLICY "Authenticated update" ON site_info.client_org FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.client_org;
CREATE POLICY approved_select ON site_info.client_org FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.corporation;
CREATE POLICY "Authenticated insert" ON site_info.corporation FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.corporation;
CREATE POLICY "Authenticated read" ON site_info.corporation FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.corporation;
CREATE POLICY "Authenticated update" ON site_info.corporation FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.corporation;
CREATE POLICY approved_select ON site_info.corporation FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.facility_type;
CREATE POLICY "Authenticated insert" ON site_info.facility_type FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.facility_type;
CREATE POLICY "Authenticated read" ON site_info.facility_type FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.facility_type;
CREATE POLICY "Authenticated update" ON site_info.facility_type FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.facility_type;
CREATE POLICY approved_select ON site_info.facility_type FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.jv_participation;
CREATE POLICY "Authenticated insert" ON site_info.jv_participation FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.jv_participation;
CREATE POLICY "Authenticated read" ON site_info.jv_participation FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.jv_participation;
CREATE POLICY "Authenticated update" ON site_info.jv_participation FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.jv_participation;
CREATE POLICY approved_select ON site_info.jv_participation FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS approved_select ON site_info.managing_entity;
CREATE POLICY approved_select ON site_info.managing_entity FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS approved_select ON site_info.org_role;
CREATE POLICY approved_select ON site_info.org_role FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.partner_company;
CREATE POLICY "Authenticated insert" ON site_info.partner_company FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.partner_company;
CREATE POLICY "Authenticated read" ON site_info.partner_company FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.partner_company;
CREATE POLICY "Authenticated update" ON site_info.partner_company FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.partner_company;
CREATE POLICY approved_select ON site_info.partner_company FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.project_site;
CREATE POLICY "Authenticated insert" ON site_info.project_site FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.project_site;
CREATE POLICY "Authenticated read" ON site_info.project_site FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.project_site;
CREATE POLICY "Authenticated update" ON site_info.project_site FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.project_site;
CREATE POLICY approved_select ON site_info.project_site FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.region_code;
CREATE POLICY "Authenticated insert" ON site_info.region_code FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.region_code;
CREATE POLICY "Authenticated read" ON site_info.region_code FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.region_code;
CREATE POLICY "Authenticated update" ON site_info.region_code FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.region_code;
CREATE POLICY approved_select ON site_info.region_code FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS approved_select ON site_info.site_department;
CREATE POLICY approved_select ON site_info.site_department FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert" ON site_info.site_memo;
CREATE POLICY "Authenticated insert" ON site_info.site_memo FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON site_info.site_memo;
CREATE POLICY "Authenticated read" ON site_info.site_memo FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated update" ON site_info.site_memo;
CREATE POLICY "Authenticated update" ON site_info.site_memo FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approved_select ON site_info.site_org_member;
CREATE POLICY approved_select ON site_info.site_org_member FOR SELECT TO authenticated
  USING (site_info.is_approved_user());

DROP POLICY IF EXISTS user_profile_delete_admin ON site_info.user_profile;
CREATE POLICY user_profile_delete_admin ON site_info.user_profile FOR DELETE TO public
  USING (site_info.is_admin());

DROP POLICY IF EXISTS user_profile_select_self_or_admin ON site_info.user_profile;
CREATE POLICY user_profile_select_self_or_admin ON site_info.user_profile FOR SELECT TO public
  USING (((id = auth.uid()) OR site_info.is_admin()));

DROP POLICY IF EXISTS user_profile_update_admin ON site_info.user_profile;
CREATE POLICY user_profile_update_admin ON site_info.user_profile FOR UPDATE TO public
  USING (site_info.is_admin())
  WITH CHECK (site_info.is_admin());

-- ═══ 권한 ═══
-- anon 에는 아무 권한도 주지 않는다. 팀 공용 프로젝트의 anon 키는 다른
-- 서비스와 공유되는 공개 키이고, 실제로 그쪽 portal 스키마도 anon 에
-- grant 자체를 주지 않는다(401 로 막힘). 원본 프로젝트는 anon 에
-- INSERT/UPDATE/DELETE/TRUNCATE 까지 열려 있어 RLS 가 유일한 방어선이었다.

GRANT USAGE ON SCHEMA site_info TO authenticated, service_role;

-- authenticated: 읽기만. 브라우저에서 직접 조회하는 참조 테이블·뷰가 있고
-- 행 단위 접근은 아래 RLS 정책이 거른다. 쓰기는 전부 백엔드를 거친다.
GRANT SELECT ON ALL TABLES IN SCHEMA site_info TO authenticated;

-- service_role: 백엔드가 쓰는 롤. RLS 를 우회하지만 테이블 권한은 별도로
-- 필요하고, SERIAL 컬럼 INSERT 를 위해 시퀀스 권한도 있어야 한다.
GRANT ALL ON ALL TABLES IN SCHEMA site_info TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA site_info TO service_role;

-- 원본 프로젝트의 현재 권한 (참고용 — 위 정책과 일부러 다르다)
--   app_fail_log: anon → DELETE
--   app_fail_log: anon → INSERT
--   app_fail_log: anon → REFERENCES
--   app_fail_log: anon → SELECT
--   app_fail_log: anon → TRIGGER
--   app_fail_log: anon → TRUNCATE
--   app_fail_log: anon → UPDATE
--   app_fail_log: authenticated → DELETE
--   app_fail_log: authenticated → INSERT
--   app_fail_log: authenticated → REFERENCES
--   app_fail_log: authenticated → SELECT
--   app_fail_log: authenticated → TRIGGER
--   app_fail_log: authenticated → TRUNCATE
--   app_fail_log: authenticated → UPDATE
--   app_fail_log: service_role → DELETE
--   app_fail_log: service_role → INSERT
--   app_fail_log: service_role → REFERENCES
--   app_fail_log: service_role → SELECT
--   app_fail_log: service_role → TRIGGER
--   app_fail_log: service_role → TRUNCATE
--   app_fail_log: service_role → UPDATE
--   client_org: anon → DELETE
--   client_org: anon → INSERT
--   client_org: anon → REFERENCES
--   client_org: anon → SELECT
--   client_org: anon → TRIGGER
--   client_org: anon → TRUNCATE
--   client_org: anon → UPDATE
--   client_org: authenticated → DELETE
--   client_org: authenticated → INSERT
--   client_org: authenticated → REFERENCES
--   client_org: authenticated → SELECT
--   client_org: authenticated → TRIGGER
--   client_org: authenticated → TRUNCATE
--   client_org: authenticated → UPDATE
--   client_org: service_role → DELETE
--   client_org: service_role → INSERT
--   client_org: service_role → REFERENCES
--   client_org: service_role → SELECT
--   client_org: service_role → TRIGGER
--   client_org: service_role → TRUNCATE
--   client_org: service_role → UPDATE
--   corporation: anon → DELETE
--   corporation: anon → INSERT
--   corporation: anon → REFERENCES
--   corporation: anon → SELECT
--   corporation: anon → TRIGGER
--   corporation: anon → TRUNCATE
--   corporation: anon → UPDATE
--   corporation: authenticated → DELETE
--   corporation: authenticated → INSERT
--   corporation: authenticated → REFERENCES
--   corporation: authenticated → SELECT
--   corporation: authenticated → TRIGGER
--   corporation: authenticated → TRUNCATE
--   corporation: authenticated → UPDATE
--   corporation: service_role → DELETE
--   corporation: service_role → INSERT
--   corporation: service_role → REFERENCES
--   corporation: service_role → SELECT
--   corporation: service_role → TRIGGER
--   corporation: service_role → TRUNCATE
--   corporation: service_role → UPDATE
--   facility_type: anon → DELETE
--   facility_type: anon → INSERT
--   facility_type: anon → REFERENCES
--   facility_type: anon → SELECT
--   facility_type: anon → TRIGGER
--   facility_type: anon → TRUNCATE
--   facility_type: anon → UPDATE
--   facility_type: authenticated → DELETE
--   facility_type: authenticated → INSERT
--   facility_type: authenticated → REFERENCES
--   facility_type: authenticated → SELECT
--   facility_type: authenticated → TRIGGER
--   facility_type: authenticated → TRUNCATE
--   facility_type: authenticated → UPDATE
--   facility_type: service_role → DELETE
--   facility_type: service_role → INSERT
--   facility_type: service_role → REFERENCES
--   facility_type: service_role → SELECT
--   facility_type: service_role → TRIGGER
--   facility_type: service_role → TRUNCATE
--   facility_type: service_role → UPDATE
--   jv_participation: anon → DELETE
--   jv_participation: anon → INSERT
--   jv_participation: anon → REFERENCES
--   jv_participation: anon → SELECT
--   jv_participation: anon → TRIGGER
--   jv_participation: anon → TRUNCATE
--   jv_participation: anon → UPDATE
--   jv_participation: authenticated → DELETE
--   jv_participation: authenticated → INSERT
--   jv_participation: authenticated → REFERENCES
--   jv_participation: authenticated → SELECT
--   jv_participation: authenticated → TRIGGER
--   jv_participation: authenticated → TRUNCATE
--   jv_participation: authenticated → UPDATE
--   jv_participation: service_role → DELETE
--   jv_participation: service_role → INSERT
--   jv_participation: service_role → REFERENCES
--   jv_participation: service_role → SELECT
--   jv_participation: service_role → TRIGGER
--   jv_participation: service_role → TRUNCATE
--   jv_participation: service_role → UPDATE
--   managing_entity: anon → DELETE
--   managing_entity: anon → INSERT
--   managing_entity: anon → REFERENCES
--   managing_entity: anon → SELECT
--   managing_entity: anon → TRIGGER
--   managing_entity: anon → TRUNCATE
--   managing_entity: anon → UPDATE
--   managing_entity: authenticated → DELETE
--   managing_entity: authenticated → INSERT
--   managing_entity: authenticated → REFERENCES
--   managing_entity: authenticated → SELECT
--   managing_entity: authenticated → TRIGGER
--   managing_entity: authenticated → TRUNCATE
--   managing_entity: authenticated → UPDATE
--   managing_entity: service_role → DELETE
--   managing_entity: service_role → INSERT
--   managing_entity: service_role → REFERENCES
--   managing_entity: service_role → SELECT
--   managing_entity: service_role → TRIGGER
--   managing_entity: service_role → TRUNCATE
--   managing_entity: service_role → UPDATE
--   org_role: anon → DELETE
--   org_role: anon → INSERT
--   org_role: anon → REFERENCES
--   org_role: anon → SELECT
--   org_role: anon → TRIGGER
--   org_role: anon → TRUNCATE
--   org_role: anon → UPDATE
--   org_role: authenticated → DELETE
--   org_role: authenticated → INSERT
--   org_role: authenticated → REFERENCES
--   org_role: authenticated → SELECT
--   org_role: authenticated → TRIGGER
--   org_role: authenticated → TRUNCATE
--   org_role: authenticated → UPDATE
--   org_role: service_role → DELETE
--   org_role: service_role → INSERT
--   org_role: service_role → REFERENCES
--   org_role: service_role → SELECT
--   org_role: service_role → TRIGGER
--   org_role: service_role → TRUNCATE
--   org_role: service_role → UPDATE
--   partner_company: anon → DELETE
--   partner_company: anon → INSERT
--   partner_company: anon → REFERENCES
--   partner_company: anon → SELECT
--   partner_company: anon → TRIGGER
--   partner_company: anon → TRUNCATE
--   partner_company: anon → UPDATE
--   partner_company: authenticated → DELETE
--   partner_company: authenticated → INSERT
--   partner_company: authenticated → REFERENCES
--   partner_company: authenticated → SELECT
--   partner_company: authenticated → TRIGGER
--   partner_company: authenticated → TRUNCATE
--   partner_company: authenticated → UPDATE
--   partner_company: service_role → DELETE
--   partner_company: service_role → INSERT
--   partner_company: service_role → REFERENCES
--   partner_company: service_role → SELECT
--   partner_company: service_role → TRIGGER
--   partner_company: service_role → TRUNCATE
--   partner_company: service_role → UPDATE
--   project_site: anon → DELETE
--   project_site: anon → INSERT
--   project_site: anon → REFERENCES
--   project_site: anon → SELECT
--   project_site: anon → TRIGGER
--   project_site: anon → TRUNCATE
--   project_site: anon → UPDATE
--   project_site: authenticated → DELETE
--   project_site: authenticated → INSERT
--   project_site: authenticated → REFERENCES
--   project_site: authenticated → SELECT
--   project_site: authenticated → TRIGGER
--   project_site: authenticated → TRUNCATE
--   project_site: authenticated → UPDATE
--   project_site: service_role → DELETE
--   project_site: service_role → INSERT
--   project_site: service_role → REFERENCES
--   project_site: service_role → SELECT
--   project_site: service_role → TRIGGER
--   project_site: service_role → TRUNCATE
--   project_site: service_role → UPDATE
--   region_code: anon → DELETE
--   region_code: anon → INSERT
--   region_code: anon → REFERENCES
--   region_code: anon → SELECT
--   region_code: anon → TRIGGER
--   region_code: anon → TRUNCATE
--   region_code: anon → UPDATE
--   region_code: authenticated → DELETE
--   region_code: authenticated → INSERT
--   region_code: authenticated → REFERENCES
--   region_code: authenticated → SELECT
--   region_code: authenticated → TRIGGER
--   region_code: authenticated → TRUNCATE
--   region_code: authenticated → UPDATE
--   region_code: service_role → DELETE
--   region_code: service_role → INSERT
--   region_code: service_role → REFERENCES
--   region_code: service_role → SELECT
--   region_code: service_role → TRIGGER
--   region_code: service_role → TRUNCATE
--   region_code: service_role → UPDATE
--   site_department: anon → DELETE
--   site_department: anon → INSERT
--   site_department: anon → REFERENCES
--   site_department: anon → SELECT
--   site_department: anon → TRIGGER
--   site_department: anon → TRUNCATE
--   site_department: anon → UPDATE
--   site_department: authenticated → DELETE
--   site_department: authenticated → INSERT
--   site_department: authenticated → REFERENCES
--   site_department: authenticated → SELECT
--   site_department: authenticated → TRIGGER
--   site_department: authenticated → TRUNCATE
--   site_department: authenticated → UPDATE
--   site_department: service_role → DELETE
--   site_department: service_role → INSERT
--   site_department: service_role → REFERENCES
--   site_department: service_role → SELECT
--   site_department: service_role → TRIGGER
--   site_department: service_role → TRUNCATE
--   site_department: service_role → UPDATE
--   site_memo: anon → DELETE
--   site_memo: anon → INSERT
--   site_memo: anon → REFERENCES
--   site_memo: anon → SELECT
--   site_memo: anon → TRIGGER
--   site_memo: anon → TRUNCATE
--   site_memo: anon → UPDATE
--   site_memo: authenticated → DELETE
--   site_memo: authenticated → INSERT
--   site_memo: authenticated → REFERENCES
--   site_memo: authenticated → SELECT
--   site_memo: authenticated → TRIGGER
--   site_memo: authenticated → TRUNCATE
--   site_memo: authenticated → UPDATE
--   site_memo: service_role → DELETE
--   site_memo: service_role → INSERT
--   site_memo: service_role → REFERENCES
--   site_memo: service_role → SELECT
--   site_memo: service_role → TRIGGER
--   site_memo: service_role → TRUNCATE
--   site_memo: service_role → UPDATE
--   site_org_member: anon → DELETE
--   site_org_member: anon → INSERT
--   site_org_member: anon → REFERENCES
--   site_org_member: anon → SELECT
--   site_org_member: anon → TRIGGER
--   site_org_member: anon → TRUNCATE
--   site_org_member: anon → UPDATE
--   site_org_member: authenticated → DELETE
--   site_org_member: authenticated → INSERT
--   site_org_member: authenticated → REFERENCES
--   site_org_member: authenticated → SELECT
--   site_org_member: authenticated → TRIGGER
--   site_org_member: authenticated → TRUNCATE
--   site_org_member: authenticated → UPDATE
--   site_org_member: service_role → DELETE
--   site_org_member: service_role → INSERT
--   site_org_member: service_role → REFERENCES
--   site_org_member: service_role → SELECT
--   site_org_member: service_role → TRIGGER
--   site_org_member: service_role → TRUNCATE
--   site_org_member: service_role → UPDATE
--   user_profile: anon → DELETE
--   user_profile: anon → INSERT
--   user_profile: anon → REFERENCES
--   user_profile: anon → SELECT
--   user_profile: anon → TRIGGER
--   user_profile: anon → TRUNCATE
--   user_profile: anon → UPDATE
--   user_profile: authenticated → DELETE
--   user_profile: authenticated → INSERT
--   user_profile: authenticated → REFERENCES
--   user_profile: authenticated → SELECT
--   user_profile: authenticated → TRIGGER
--   user_profile: authenticated → TRUNCATE
--   user_profile: authenticated → UPDATE
--   user_profile: service_role → DELETE
--   user_profile: service_role → INSERT
--   user_profile: service_role → REFERENCES
--   user_profile: service_role → SELECT
--   user_profile: service_role → TRIGGER
--   user_profile: service_role → TRUNCATE
--   user_profile: service_role → UPDATE

-- ═══ 시퀀스 현재값 (데이터 이관 후 setval 필요) ═══
--   app_fail_log_fail_id_seq: last_value=1
--   client_org_id_seq: last_value=38
--   corporation_id_seq: last_value=3
--   jv_participation_id_seq: last_value=672
--   managing_entity_id_seq: last_value=8
--   org_role_id_seq: last_value=8
--   partner_company_id_seq: last_value=117
--   project_site_id_seq: last_value=251
--   site_department_id_seq: last_value=699
--   site_memo_id_seq: last_value=None
--   site_org_member_id_seq: last_value=278

COMMIT;
