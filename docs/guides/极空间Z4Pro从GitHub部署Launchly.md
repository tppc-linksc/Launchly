# 极空间 Z4 Pro：从 GitHub 部署 Launchly

> **状态（2026-08-14）**：计划稿，暂停执行。当前基线尚未通过 R0/R1 的完整验收，也没有真实 NAS E2E 证据。只有[项目重启路线图](../basic/项目重启路线图.md)的 R0、R1 退出条件全部通过后，本文才能升级为正式 Runbook。

本文把 **Launchly 控制面** 安装到极空间 Z4 Pro。完成后可以在局域网打开 Launchly、创建 Owner 和 Workspace，并把这台 NAS 加为 BYOS 部署目标。

> 本文使用 GitHub 源码构建安装，不依赖尚未确认可公开拉取的 GHCR 镜像。它不代表 HTTPS、外网域名或 NAS 真实 E2E 已验收。

## 0. 前提与边界

- NAS 必须已启用 Docker、Docker Compose v2 与 SSH；为 Launchly 预留至少 2 GB 内存和 10 GB 持久空间。
- `<NAS_IP>`、`<NAS_WORK_ROOT>`、`<NAS_SSH_USER>` 都要替换为真实值。`<NAS_WORK_ROOT>` 必须是 SSH 用户与 Docker 都可写的持久卷绝对路径，不能是 `/tmp`。
- 先确认要部署的 commit 已推送到 GitHub。本地未提交改动不会自动出现在 NAS。
- 本教程先使用 `http://<NAS_IP>:8080`。当前只有 HTTP Nginx 路由代码；HTTPS/Let's Encrypt 尚未完成真实 E2E。

## 1. 准备 NAS

通过 NAS SSH 终端或电脑终端执行以下检查：

```bash
docker info
docker compose version
df -h
```

三项都必须成功。若 `docker info` 仅能以 root 运行，请在 NAS 中创建专用的非 root 部署用户，并授予它 Docker 权限；Launchly 不接受 root 作为部署目标用户。

创建控制面目录。下例中的路径只是示例，必须改成 NAS 上真实的持久卷路径：

```bash
mkdir -p <NAS_WORK_ROOT>/launchly-control
chmod 700 <NAS_WORK_ROOT>/launchly-control
```

如果 GitHub 仓库是私有仓库，在 NAS 创建只读 Deploy Key，并把公钥添加到 GitHub 仓库的 `Settings → Deploy keys`：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/launchly-github -C "z4pro-launchly"
cat ~/.ssh/launchly-github.pub
```

只复制公钥到 GitHub；私钥不要离开 NAS。

## 2. 从 GitHub 获取源码和配置密钥

公开仓库可使用 HTTPS；私有仓库请改用 SSH 地址：

```bash
cd <NAS_WORK_ROOT>/launchly-control
git clone --branch master --depth 1 https://github.com/tppc-linksc/Launchly.git .
git rev-parse --short HEAD
cp .env.example .env
```

编辑 `.env` 并替换三条密钥。请在自己的电脑用 `openssl rand -hex 32` 生成三条**不同**的随机值后粘贴；不得保留示例开发密钥。

```dotenv
LAUNCHLY_DB_PASSWORD=<随机数据库密码>
LAUNCHLY_JWT_SECRET=<随机JWT密钥>
LAUNCHLY_ENCRYPTION_KEY=<随机加密主密钥>
LAUNCHLY_APP_PORT=8080
# Lite 默认不在 NAS 常驻 BuildKit。
COMPOSE_PROFILES=
```

`.env` 不得提交回 GitHub，也不要在聊天、Issue 或截图中暴露其内容。

## 3. 构建并启动控制面

在仓库根目录执行：

```bash
docker compose -f deploy/compose/docker-compose.yml --env-file .env config
docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/compose/docker-compose.yml --env-file .env ps
curl -fsS http://127.0.0.1:8080/api/health
```

预期是 `postgres` 健康、`migrate` 成功退出、`api` 和 `worker` 持续运行。若迁移失败，API/Worker 不应启动；查看日志：

```bash
docker compose -f deploy/compose/docker-compose.yml --env-file .env logs --tail=200 migrate api worker
```

然后在电脑浏览器打开 `http://<NAS_IP>:8080/setup`，创建 Launchly Owner、密码和默认 Workspace，再登录。

## 4. 把 Z4 Pro 添加为部署目标

这一步使 Launchly 能将业务应用发布到 NAS；它与第 3 步安装控制面不同。

1. 在电脑生成一对专用于 Launchly → NAS 的密钥：

   ```bash
   ssh-keygen -t ed25519 -f ./launchly-z4pro-deploy -C "launchly-z4pro"
   ```

2. 将 `launchly-z4pro-deploy.pub` 添加到 NAS 部署用户的 `~/.ssh/authorized_keys`；不要复制私钥。
3. 从可信网络获取 NAS Host Key：

   ```bash
   ssh-keyscan -p 22 -t ed25519 <NAS_IP>
   ```

   必须再与 NAS 本机或可信管理界面显示的指纹比对，不能只因为命令有输出就信任。
4. 在 Launchly 进入「项目 → 部署目标 → 添加部署目标」，填写 NAS IP、非 root Docker 用户、私钥、已核对的 Host Key，以及 `<NAS_WORK_ROOT>/launchly` 作为“Launchly 工作目录”。
5. 点击「验证」。Docker、Compose v2、架构、目录写入、磁盘和 80 端口提示都符合预期后，才可部署。

80 端口若被 NAS 自带 Web 服务或其他反向代理占用，不能启用 Launchly 自动 HTTP 域名路由；仍可先用应用回退端口测试。

## 5. 首个业务应用：先用 OCI digest 镜像

当前最稳妥的首个业务应用路径是 GitHub Actions 先构建镜像到 GHCR/Docker Hub，再在 Launchly 选择「现有 OCI 镜像」，填写完整 digest：

```text
ghcr.io/<组织或用户名>/<镜像名>@sha256:<64位摘要>
```

禁止填写 `latest` 或普通 tag。然后设置容器端口、健康检查路径、测试环境与已验证的 Z4 Pro 目标，再触发部署。首次不要填写域名，先确认镜像拉取、Compose 启动和健康检查成功。

Git 源码资源的 BuildKit 路径还需要“可推送 OCI Registry + 构建节点对 Registry 的认证”。当前 UI 尚未提供 Registry 登录凭据管理，所以它不适合作为第一次成功部署路径。

## 6. 更新和备份

更新前先备份数据库；然后拉取确定的 Git commit 并重建：

```bash
docker compose -f deploy/compose/docker-compose.yml --env-file .env exec -T postgres pg_dump -U launchly launchly > launchly-backup.sql
git fetch origin master
git pull --ff-only origin master
docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/compose/docker-compose.yml --env-file .env ps
```

`launchly-backup.sql` 与 `.env` 都含敏感数据，应放到 NAS 的受限备份目录，不能上传公开仓库。

## 7. 仍需真实验收的能力

本教程只覆盖安装与配置，不能证明 GitHub webhook 自动部署、私有 Registry 推送、外网 DNS、HTTPS/证书续期、Worker 崩溃恢复、多项目并发、真实自动回滚和恢复备份已经在这台 NAS 上通过。每项都需独立真实 E2E 记录。
