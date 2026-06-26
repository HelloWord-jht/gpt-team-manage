# GPT Team Manage

自用 Team Bus 账号车位管理系统，从 Excel 记录整理为一个无登录 Web 管理台。

## 功能

- 账号、地区、成本、成员、利润、状态和备注管理
- 成员邮箱、上车日期、下车日期管理
- 按月查询当月有效成员
- 搜索、地区筛选、状态筛选
- 按开通日期对应币种汇率换算人民币成本，并计算真实利润
- QQ 邮箱 SMTP 续费提醒
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

执行：

```bash
git clone https://github.com/HelloWord-jht/gpt-team-manage.git
cd gpt-team-manage
bash scripts/start-centos7.sh
```

如果服务器还没有 Docker，脚本会尝试通过 `yum` 自动安装并启动 Docker。

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

汇率缓存文件在：

```text
data/exchange-rates.json
```

这个文件会自动生成，不需要手动编辑。

## QQ 邮箱 SMTP 配置

首次运行 `scripts/start-centos7.sh` 会生成服务器本地 `.env` 文件，并提示输入 SMTP 授权码。`.env` 已加入 `.gitignore`，不会提交到 GitHub。

也可以手动创建：

```bash
cp .env.example .env
vi .env
chmod 600 .env
```

示例：

```text
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=892029465@qq.com
SMTP_PASS=你的QQ邮箱SMTP授权码
REMINDER_TO=892029465@qq.com
REMINDER_DAYS=7
```

改完后重启：

```bash
docker restart gpt-team-manage
```

## docker compose 启动

服务器有 Docker Compose 时也可以使用：

```bash
docker compose up -d --build
```

老版本命令：

```bash
docker-compose up -d --build
```
