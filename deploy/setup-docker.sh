#!/bin/bash
# ============================================================
# Lightsail 초기 서버 세팅 (Docker 기반, Ubuntu 22.04 / 24.04)
# 최초 1회만 실행
# ============================================================
set -e

echo "=== 1. 시스템 업데이트 ==="
sudo apt update && sudo apt upgrade -y

echo "=== 2. Docker 설치 ==="
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh
  sudo usermod -aG docker $USER
  rm /tmp/get-docker.sh
  echo "  → docker 설치 완료. 그룹 적용을 위해 한 번 재로그인 필요."
fi

echo "=== 3. Git + 프로젝트 클론 ==="
sudo apt install -y git
cd /home/ubuntu
if [ ! -d "app" ]; then
  git clone https://github.com/namkwang/Site-Info.git app
fi
cd app

echo "=== 4. 환경변수 파일 생성 ==="
if [ ! -f "backend/.env" ]; then
  cat > backend/.env << 'ENVEOF'
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
KAKAO_REST_KEY=your_kakao_key
ENVEOF
  echo "  ⚠️  backend/.env 파일을 실제 값으로 수정하세요!"
fi

echo "=== 5. Docker compose 이미지 pull + 기동 ==="
echo "  (sudo로 docker 호출 — 처음엔 그룹 권한 적용 전이라)"
sudo docker compose pull
sudo docker compose up -d

echo "=== 6. 자동 시작 등록 ==="
# Docker는 서비스로 부팅 시 자동 기동, restart:unless-stopped 가 컨테이너도 살림
sudo systemctl enable docker

echo ""
echo "✅ 세팅 완료!"
echo "  - http://<서버IP> 접속"
echo "  - 상태 확인: sudo docker compose ps"
echo "  - 로그: sudo docker compose logs -f"
echo ""
echo "⚠️  backend/.env 가 비어있으면 backend 컨테이너가 기동 실패합니다."
echo "    수정 후: sudo docker compose up -d --force-recreate backend"
