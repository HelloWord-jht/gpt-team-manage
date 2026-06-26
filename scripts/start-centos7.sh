#!/usr/bin/env bash
set -euo pipefail

APP_NAME="gpt-team-manage"
PORT="${PORT:-5176}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUDO="sudo"

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=""
fi

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker 未安装，开始尝试自动安装 Docker Engine ..."
  if ! command -v yum >/dev/null 2>&1; then
    echo "未检测到 yum，无法自动安装 Docker。"
    exit 1
  fi

  $SUDO yum install -y yum-utils
  $SUDO yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  $SUDO yum install -y docker-ce docker-ce-cli containerd.io || $SUDO yum install -y docker
  $SUDO systemctl enable --now docker
fi

mkdir -p data

if [ ! -f data/team-bus.json ]; then
  echo "[]" > data/team-bus.json
fi

if [ ! -f .env ]; then
  echo "首次启动：生成本地 .env。SMTP 授权码只保存在服务器本地，不会进 git。"
  smtp_user="${SMTP_USER:-892029465@qq.com}"
  reminder_to="${REMINDER_TO:-892029465@qq.com}"
  smtp_pass="${SMTP_PASS:-}"
  if [ -z "$smtp_pass" ]; then
    read -r -s -p "请输入 QQ 邮箱 SMTP 授权码（可直接回车跳过，之后再编辑 .env）： " smtp_pass
    echo
  fi

  cat > .env <<EOF
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=${smtp_user}
SMTP_PASS=${smtp_pass}
REMINDER_TO=${reminder_to}
REMINDER_DAYS=7
EOF
  chmod 600 .env
fi

echo "构建镜像 ${APP_NAME}:latest ..."
docker build -t "${APP_NAME}:latest" .

if docker ps -a --format '{{.Names}}' | grep -qx "$APP_NAME"; then
  echo "停止并移除旧容器 ${APP_NAME} ..."
  docker rm -f "$APP_NAME" >/dev/null
fi

echo "启动容器 ${APP_NAME}，端口 ${PORT} ..."
docker run -d \
  --name "$APP_NAME" \
  --restart unless-stopped \
  --env-file "$ROOT_DIR/.env" \
  -e HOST=0.0.0.0 \
  -e PORT=5176 \
  -e DATA_PATH=/app/data/team-bus.json \
  -p "${PORT}:5176" \
  -v "$ROOT_DIR/data:/app/data" \
  "${APP_NAME}:latest" >/dev/null

echo "启动完成：http://服务器IP:${PORT}"
echo "查看日志：docker logs -f ${APP_NAME}"
