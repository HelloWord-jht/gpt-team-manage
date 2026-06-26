#!/usr/bin/env bash
set -euo pipefail

APP_NAME="gpt-team-manage"
PORT="${PORT:-5176}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker 未安装。请先在 CentOS 7 上安装 Docker Engine 后重试。"
  echo "参考命令：sudo yum install -y yum-utils && sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo && sudo yum install -y docker-ce docker-ce-cli containerd.io && sudo systemctl enable --now docker"
  exit 1
fi

mkdir -p data

if [ ! -f data/team-bus.json ]; then
  echo "[]" > data/team-bus.json
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
  -e HOST=0.0.0.0 \
  -e PORT=5176 \
  -e DATA_PATH=/app/data/team-bus.json \
  -p "${PORT}:5176" \
  -v "$ROOT_DIR/data:/app/data" \
  "${APP_NAME}:latest" >/dev/null

echo "启动完成：http://服务器IP:${PORT}"
echo "查看日志：docker logs -f ${APP_NAME}"
