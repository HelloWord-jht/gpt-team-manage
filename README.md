# GPT Team Manage

自用 Team Bus 账号车位管理系统，从 Excel 记录整理为一个无登录 Web 管理台。

## 功能

- 账号、地区、成本、成员、利润、状态和备注管理
- 搜索、地区筛选、状态筛选
- 新增、编辑、删除账号
- JSON 文件持久化，默认数据文件为 `data/team-bus.json`
- Docker 一键启动，适合部署到 CentOS 7 服务器

## 本地运行

```bash
node --test
node src/server.js
```

访问：

```text
http://127.0.0.1:5176
```

## CentOS 7 Docker 一键启动

先确保服务器已安装 Docker，然后执行：

```bash
git clone https://github.com/HelloWord-jht/gpt-team-manage.git
cd gpt-team-manage
bash scripts/start-centos7.sh
```

默认监听服务器 `5176` 端口：

```text
http://服务器IP:5176
```

如果要换宿主机端口：

```bash
PORT=8080 bash scripts/start-centos7.sh
```

## 常用运维命令

```bash
docker logs -f gpt-team-manage
docker restart gpt-team-manage
docker rm -f gpt-team-manage
```

数据文件在宿主机仓库目录：

```text
data/team-bus.json
```

备份这个文件即可保留系统数据。

## docker compose 启动

服务器有 Docker Compose 时也可以使用：

```bash
docker compose up -d --build
```

老版本命令：

```bash
docker-compose up -d --build
```
