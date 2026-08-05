# Deployment

## Stacks

| 스크립트 | 용도 |
|---|---|
| `setup-docker.sh` / `deploy-docker.sh` | **현재 운영** — Docker 기반, GHCR 이미지 |
| `setup.sh` / `deploy.sh` | 레거시 — host에 직접 node·python 설치하던 방식 (유지보수 X) |
| `ecosystem.config.js` | 레거시 PM2 설정 |

## Architecture

```
[browser] ──▶ :80 ──▶ nginx (container)
                       ├──▶ /        ──▶ web (container, Next.js standalone, :3000)
                       └──▶ /api/*   ──▶ backend (container, FastAPI/uvicorn, :8001)
```

세 컨테이너 모두 같은 docker network 안에서 service name으로 서로 호출.
이미지는 **GitHub Container Registry (GHCR)**에 push된다.

## Required GitHub Repository Secrets

`Settings → Secrets and variables → Actions`에서 등록.

| 이름 | 내용 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL (e.g. `https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase `anon public` 키 (긴 JWT) |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | Kakao Developers `JavaScript 키` |

> 이 세 개는 프론트 빌드 시점에 JS 번들에 박힌다 (`NEXT_PUBLIC_*` 규약).
> `SUPABASE_SERVICE_ROLE_KEY` 와 `KAKAO_REST_KEY` 는 서버의 `backend/.env`로
> 만 들어가며 GitHub Secrets에는 넣지 않는다 (이미지에 포함하지 않음).

> `NEXT_PUBLIC_DB_SCHEMA` 는 secrets 가 아니라 워크플로에 값을 직접 적어 뒀다
> (`site_info`). 비밀이 아니고 환경마다 다르지도 않은데, secrets 로 두면 등록을
> 빠뜨렸을 때 빈 값이 조용히 박히는 위 함정에 그대로 걸린다.

> 배포는 CI 가 하지 않으므로 `DEPLOY_*` 류 secrets 는 없다. 필요한 건 위 3개뿐.

> **레포를 옮기면 Secrets는 따라오지 않는다.** 새 레포에 다시 넣어야 한다.
> 빠뜨리면 워크플로는 성공하는데 `NEXT_PUBLIC_*` 이 빈 값으로 번들에 박혀서,
> 배포는 된 것처럼 보이고 앱만 죽는다.

## Server: 새 인스턴스 처음 띄울 때

```bash
ssh ubuntu@<IP>

# 한 번만:
git clone https://github.com/namkwang/Site-Info.git ~/app-tmp
bash ~/app-tmp/deploy/setup-docker.sh
# (docker 그룹 적용 위해 로그아웃 → 재접속 한 번)

# backend/.env 채우기:
nano ~/app/backend/.env
# (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_SCHEMA, KAKAO_REST_KEY)
#  DB_SCHEMA=site_info — 비우면 코드 기본값 pmis 로 붙어 테이블을 못 찾는다.

# 백엔드만 다시 띄우기:
cd ~/app && sudo docker compose up -d --force-recreate backend
```

방화벽: Lightsail Networking 탭에서 80(HTTP) 열기. 22(SSH)는 기본 열림.

## Server: 평소 배포 흐름

1. 로컬에서 코드 수정 → `git push`
2. GitHub Actions가 자동으로 Docker 이미지 3개 빌드 + GHCR push (`latest` + `<short-sha>`)
3. 서버에서 — **이 단계는 자동이 아니다. 직접 실행해야 운영에 반영된다:**
   ```bash
   ssh ubuntu@siteinfo.axworks.app "cd ~/app && bash deploy/deploy-docker.sh"
   ```

`deploy-docker.sh` 가 `git pull → docker compose pull → up -d → image prune` 자동.

## 롤백

```bash
ssh ubuntu@<IP>
cd ~/app
IMAGE_TAG=sha-<7자리커밋> sudo docker compose up -d
```

GHCR에 push된 sha 태그를 지정하면 그 시점 이미지로 즉시 회귀.
태그 목록: https://github.com/namkwang/Site-Info/pkgs/container/site-info-web

## 디버깅

```bash
sudo docker compose ps                     # 상태
sudo docker compose logs -f --tail=100     # 전체 로그 follow
sudo docker compose logs -f backend        # 특정 서비스만
sudo docker compose exec backend bash      # 컨테이너 안으로 들어가기
sudo docker stats                          # 컨테이너별 RAM/CPU
```

## 메모리 (2GB 인스턴스 기준)

- 평소 컨테이너 합계 ≈ 700–900MB + Docker daemon 150MB
- 빌드는 서버에서 안 돈다 (CI에서 빌드) → 피크 위험 ↓
- swap 2GB 깔려있으면 안전

## 팀 Supabase 프로젝트 컷오버 (2026-08-05)

DB가 개인 Supabase 프로젝트에서 팀 운영 프로젝트(스키마 `site_info`)로 옮겨졌다.
데이터·사용자·사진 이관은 완료됐고(`backend/scripts/copy_*.py`), 남은 것은 배포
설정 교체다. **순서가 중요하다** — 프론트는 빌드 시점에 Supabase 주소가 번들에
박히므로, 서버 env 를 먼저 바꾸면 브라우저는 옛 프로젝트를 보고 백엔드는 새
프로젝트를 봐서 앱이 깨진다.

1. **GitHub Secrets 두 개를 팀 프로젝트 값으로 교체**
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (값은 `backend/.env` 의 `PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY`)
2. **이미지 재빌드** — push 하거나 Actions 에서 워크플로를 수동 실행
3. **서버 `~/app/backend/.env` 교체** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DB_SCHEMA=site_info`
4. **배포** — `ssh ubuntu@siteinfo.axworks.app "cd ~/app && bash deploy/deploy-docker.sh"`
5. **확인** — 로그인, 대시보드 118건, 조직도, 현장 사진

### 롤백
`backend/.env` 의 `OLD_SUPABASE_URL` / `OLD_SUPABASE_SERVICE_ROLE_KEY` / `OLD_DB_SCHEMA=pmis`
로 되돌리고 GitHub Secrets 도 옛 값으로 바꿔 재빌드하면 복구된다. 그래서 개인
프로젝트는 안정화가 확인될 때까지 **삭제하지 않는다.**

### 컷오버 시점 주의
개인 프로젝트에서 데이터를 복사한 뒤로 두 DB 는 각자 흘러간다. 컷오버 전에
옛 앱에서 데이터가 수정되면 그 변경은 유실된다 — 컷오버 직전에 사용자에게
알리고, 필요하면 `copy_data.py` 로 다시 옮긴다(대상 테이블을 비운 뒤).
