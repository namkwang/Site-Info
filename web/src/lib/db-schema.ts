/** 우리 테이블이 사는 Supabase 스키마 이름.
 *
 *  팀 공용 프로젝트에서는 `site_info`, 개인 개발 프로젝트는 기존 `pmis` 를
 *  쓰므로 환경변수로 뺐다. 브라우저에서도 읽으므로 NEXT_PUBLIC_ 접두어가
 *  필요하다. 새 코드에서 스키마 이름을 문자열로 박지 말 것 —
 *  `.schema(DB_SCHEMA)` 를 쓰면 이름 변경이 env 한 줄로 끝난다. */
export const DB_SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA ?? "pmis";
