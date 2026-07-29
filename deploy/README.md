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
| `DEPLOY_HOST` | 배포 대상 서버 IP/호스트 |
| `DEPLOY_USER` | SSH 계정 (보통 `ubuntu`) |
| `DEPLOY_SSH_KEY` | SSH 개인키 전문 |

> 위 세 개(`NEXT_PUBLIC_*`)는 프론트 빌드 시점에 JS 번들에 박힌다 (`NEXT_PUBLIC_*` 규약).
> `SUPABASE_SERVICE_ROLE_KEY` 와 `KAKAO_REST_KEY` 는 서버의 `backend/.env`로
> 만 들어가며 GitHub Secrets에는 넣지 않는다 (이미지에 포함하지 않음).
> 아래 `DEPLOY_*` 세 개는 `docker-publish.yml` 의 deploy job이 SSH 접속에 쓴다.

> **레포를 옮기면 Secrets는 따라오지 않는다.** 새 레포에 위 6개를 다시 넣어야
> 한다. 빠뜨리면 워크플로는 성공하는데 `NEXT_PUBLIC_*` 이 빈 값으로 번들에
> 박혀서, 배포는 된 것처럼 보이고 앱만 죽는다.

## Server: 새 인스턴스 처음 띄울 때

```bash
ssh ubuntu@<IP>

# 한 번만:
git clone https://github.com/namkwang/Site-Info.git ~/app-tmp
bash ~/app-tmp/deploy/setup-docker.sh
# (docker 그룹 적용 위해 로그아웃 → 재접속 한 번)

# backend/.env 채우기:
nano ~/app/backend/.env
# (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KAKAO_REST_KEY)

# 백엔드만 다시 띄우기:
cd ~/app && sudo docker compose up -d --force-recreate backend
```

방화벽: Lightsail Networking 탭에서 80(HTTP) 열기. 22(SSH)는 기본 열림.

## Server: 평소 배포 흐름

1. 로컬에서 코드 수정 → `git push`
2. GitHub Actions가 자동으로 Docker 이미지 3개 빌드 + GHCR push (`latest` + `<short-sha>`)
3. 서버에서:
   ```bash
   ssh ubuntu@<IP> "cd ~/app && bash deploy/deploy-docker.sh"
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
