-- 022: 포털 SSO 티켓 (1회용, 60초)
--
-- 흐름: 포털 로그인 → 포털 서버가 우리 티켓 발급 API 를 호출(서버-투-서버,
--   공유 토큰) → 브라우저를 /sso?ticket=… 로 리디렉트 → 우리가 티켓을 검증하고
--   세션 쿠키를 내려 자동 로그인.
--
-- 티켓을 DB 에 두는 이유:
--   - **1회용 보장**을 원자적으로 해야 한다. 인메모리로 하면 재시작에 사라지고
--     (60초라 큰 문제는 아니지만) 백엔드를 2대 이상으로 늘리는 순간 같은 티켓이
--     두 번 쓰일 수 있다.
--   - 누가 언제 SSO 로 들어왔는지 감사 기록이 남는다.
--
-- 티켓 원문이 아니라 **해시**를 저장한다. DB 를 읽을 수 있는 사람이 그것만으로
-- 남의 세션을 만들 수 없게 하기 위해서다(짧은 수명이라도 원칙은 같다).

BEGIN;

CREATE TABLE IF NOT EXISTS site_info.sso_ticket (
  ticket_hash  TEXT PRIMARY KEY,          -- sha256(ticket)
  employee_no  TEXT NOT NULL,
  role_code    TEXT,                      -- 포털이 보낸 원문 (매핑 전)
  full_name    TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,               -- 사용 시각. NULL 이면 미사용
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 만료·사용 정리와 감사 조회용
CREATE INDEX IF NOT EXISTS idx_sso_ticket_expires ON site_info.sso_ticket (expires_at);
CREATE INDEX IF NOT EXISTS idx_sso_ticket_employee
  ON site_info.sso_ticket (employee_no, created_at DESC);

-- 티켓은 사용자에게 노출될 이유가 전혀 없다. RLS 를 켜고 정책을 두지 않아
-- service_role(백엔드)만 접근한다 — user_credential 과 같은 방식이다.
ALTER TABLE site_info.sso_ticket ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON site_info.sso_ticket FROM anon, authenticated;
GRANT ALL ON site_info.sso_ticket TO service_role;

COMMIT;
