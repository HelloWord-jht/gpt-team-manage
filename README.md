# GPT Team Manage

自用 Team Bus 账号车位管理系统，从 Excel 记录整理为一个无登录 Web 管理台。

## 功能

- 账号、地区、成本、成员、利润、状态和备注管理
- 成员邮箱、上车日期、下车日期管理
- 按月查询当月有效成员
- 搜索、地区筛选、状态筛选
- 按开通日期对应币种汇率换算人民币成本，并计算真实利润
- QQ 邮箱 SMTP 给车主发送待续费汇总提醒
- 每天自动扫描，默认提前 3 天提醒，每个车每个续费周期只提醒一次
- 续费工作台集中查看待处理账号、成员邮箱、续费金额和邮件发送状态
- 支持标记或撤销当前续费周期的“已处理”状态，不影响账号和成员资料
- 居中账号弹框与成员二级弹框，成员修改随账号一起保存
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

运行数据在宿主机仓库的 `data/` 目录，建议备份整个目录：

```text
data/team-bus.json
data/reminder-history.json
data/renewal-actions.json
```

其中 `renewal-actions.json` 保存续费工作台的当前周期处理记录。进入下一个续费周期后，车辆会自动重新出现在待处理列表中。

汇率缓存文件在：

```text
data/exchange-rates.json
```

这个文件会自动生成，不需要手动编辑。

续费提醒发送历史在：

```text
data/reminder-history.json
```

这个文件用于避免同一个车同一个续费周期重复提醒，也会自动生成。

## 续费工作台

点击顶部的“续费工作台”打开待续费列表。默认显示未来 3 天内尚未处理的车辆，也可以切换到全部周期记录。

- “发送待续费摘要”只发送到 `.env` 中的 `REMINDER_TO`，不会直接给成员发邮件。
- “标记已处理”只记录当前车辆的当前续费周期，不会修改账号状态、成员上下车日期或收款状态。
- 标记后车辆退出默认待处理列表；撤销后会立即恢复。

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
SMTP_FROM=不高兴 <892029465@qq.com>
REMINDER_TO=jht19950420@gmail.com
REMINDER_DAYS=3
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
