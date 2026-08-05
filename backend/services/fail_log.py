"""부가 작업 실패를 DB에 남기는 헬퍼 (pmis.app_fail_log).

쓰는 곳: 요청 자체는 성공시켜야 하지만 곁가지 작업이 실패한 경우 —
사진 URL 저장, 기본 부서 시드, 관리부서 조회 실패 등. 기존에는
print("[WARN] …") 로만 남겨 재시작하면 사라졌다.

원칙:
  - **절대 예외를 올리지 않는다.** 로깅 실패가 본 요청을 깨면 안 된다.
  - stdout 출력도 유지한다. 개발 중에는 터미널이 가장 빠른 피드백이고,
    DB 기록이 실패한 경우 최후의 흔적이 된다.
  - raw_data 에 개인정보를 넣지 않는다. 재현에 필요한 식별자와 상태만.
"""
import json
from typing import Any, Optional

from supabase_client import db


def log_failure(
    target: str,
    error: BaseException | str,
    *,
    source_key: Optional[Any] = None,
    raw_data: Optional[dict] = None,
    actor_id: Optional[str] = None,
) -> None:
    """실패 1건을 기록한다. target 은 'org.photo_url_persist' 처럼
    <모듈>.<작업> 형태로 안정된 문자열을 쓴다 — 나중에 이 값으로 집계한다."""
    message = str(error)
    print(f"[WARN] {target}"
          f"{f' [{source_key}]' if source_key is not None else ''}: {message}")
    try:
        db().from_("app_fail_log").insert({
            "target": target[:80],
            "source_key": None if source_key is None else str(source_key)[:120],
            "error_message": message,
            # jsonb 컬럼이므로 직렬화 가능한 값만 통과시킨다.
            "raw_data": json.loads(json.dumps(raw_data, default=str)) if raw_data else None,
            "actor_id": actor_id,
        }).execute()
    except Exception as e:
        # 여기서 더 할 수 있는 일이 없다. 위의 print 가 유일한 흔적이 된다.
        print(f"[WARN] fail_log write failed ({target}): {e}")


def recent_failures(limit: int = 100, target: Optional[str] = None) -> list[dict]:
    """관리자 조회용. 실패 로그를 최신순으로 반환한다."""
    q = db().from_("app_fail_log").select("*").order("created_at", desc=True)
    if target:
        q = q.eq("target", target)
    return q.limit(min(limit, 500)).execute().data or []
