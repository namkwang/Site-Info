#!/bin/bash
# ============================================================
# Lightsail 초기 서버 세팅 (Ubuntu 22.04)
# 최초 1회만 실행
# ============================================================
set -e

echo "=== 1. 시스템 업데이트 ==="
sudo apt update && sudo apt upgrade -y

echo "=== 2. Node.js 20 설치 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "=== 3. PM2 설치 ==="
sudo npm install -g pm2

echo "=== 4. Python 3.11 + venv 설치 ==="
sudo apt install -y python3.11 python3.11-venv python3-pip

echo "=== 5. Nginx 설치 ==="
sudo apt install -y nginx

echo "=== 6. Git 설치 ==="
sudo apt install -y git

echo "=== 7. 프로젝트 클론 ==="
cd /home/ubuntu
if [ ! -d "app" ]; then
  git clone https://github.com/namkwang/Site-Info.git app
fi
cd app

echo "=== 8. Backend 세팅 ==="
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..

echo "=== 9. Frontend 세팅 ==="
cd web
npm ci
npm run build
cd ..

echo "=== 10. Nginx 설정 ==="
sudo cp deploy/nginx.conf /etc/nginx/sites-available/siteinformation
sudo ln -sf /etc/nginx/sites-available/siteinformation /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "=== 11. 환경변수 파일 생성 ==="
if [ ! -f "backend/.env" ]; then
  cat > backend/.env << 'ENVEOF'
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
KAKAO_REST_KEY=your_kakao_key
ENVEOF
  echo "⚠️  backend/.env 파일을 수정하세요!"
fi

if [ ! -f "web/.env.local" ]; then
  cat > web/.env.local << 'ENVEOF'
NEXT_PUBLIC_API_BASE=http://localhost:8001
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_KAKAO_JS_KEY=your_kakao_js_key
ENVEOF
  echo "⚠️  web/.env.local 파일을 수정하세요!"
fi

echo "=== 12. PM2 시작 ==="
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash

echo ""
echo "✅ 세팅 완료!"
echo "  - 프론트엔드: http://<서버IP>"
echo "  - API: http://<서버IP>/api/"
echo ""
echo "⚠️  다음 파일의 환경변수를 실제 값으로 수정하세요:"
echo "  - backend/.env"
echo "  - web/.env.local"
echo "  수정 후: pm2 restart all"
