#!/bin/bash
# ============================================================
# 업데이트 배포 (Docker 기반)
# main 에 push 되면 GitHub Actions 가 이미지 빌드 + GHCR push.
# 이 스크립트는 그 이미지를 받아서 갈아끼우기만 한다.
# ============================================================
set -e

cd /home/ubuntu/app

# docker-compose.yml 의 web 서비스가 APP_JWT_SECRET(세션 토큰 서명키)을 참조한다.
# compose 는 backend/.env 를 자동으로 읽지 않으므로(그건 backend 컨테이너의
# env_file 일 뿐이다) 여기서 셸에 올려 치환에 쓰이게 한다.
#
# env_file 로 web 에 붙이지 않는 이유: 그러면 SUPABASE_SERVICE_ROLE_KEY 까지
# web 컨테이너에 들어간다. 아래 방식은 compose 가 참조하는 변수만 전달된다.
if [ -f backend/.env ]; then
  set -a; . ./backend/.env; set +a
fi
if [ -z "${APP_JWT_SECRET:-}" ]; then
  echo "APP_JWT_SECRET 이 backend/.env 에 없습니다." >&2
  echo "  없으면 로그인이 전부 실패합니다 — 로컬 backend/.env 의 값과 같아야 합니다." >&2
  exit 1
fi

# compose 는 `sudo` 로 돌리므로 셸에서 export 해도 전달되지 않는다
# (sudo 가 환경을 초기화한다). compose 가 자동으로 읽는 프로젝트 .env 에
# 옮겨 적어서 치환이 되게 한다. 다른 변수(IMAGE_TAG 등)는 건드리지 않는다.
python3 - <<'PYEOF'
import os, re, pathlib
p = pathlib.Path(".env")
s = p.read_text(encoding="utf-8") if p.exists() else ""
line = "APP_JWT_SECRET=" + os.environ["APP_JWT_SECRET"]
if re.search(r"^APP_JWT_SECRET=", s, re.M):
    s = re.sub(r"^APP_JWT_SECRET=.*$", line, s, count=1, flags=re.M)
else:
    s = (s.rstrip("\n") + "\n" if s else "") + \
        "# compose 치환용. 원본은 backend/.env — deploy-docker.sh 가 동기화한다.\n" + line + "\n"
p.write_text(s, encoding="utf-8")
PYEOF

echo "=== 1. 최신 코드 pull (compose 파일 변경 반영) ==="
git pull origin main

echo "=== 2. 새 이미지 pull ==="
sudo docker compose pull

echo "=== 3. 컨테이너 갈아끼우기 ==="
sudo docker compose up -d

echo "=== 4. 안 쓰는 옛 이미지 정리 ==="
sudo docker image prune -f

echo ""
echo "✅ 배포 완료"
sudo docker compose ps
