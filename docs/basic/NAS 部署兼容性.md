# NAS 部署兼容性

> **状态（2026-08-13）**：本文是 R1 的兼容性目标和验收前置条件，不是当前可执行的安装承诺。R0 工程基线和 R1 首次部署尚未通过；在[项目重启路线图](./项目重启路线图.md)对应阶段退出前，不应据此宣称 Launchly 已支持 NAS 生产部署。

Launchly 可以把 NAS 作为 **BYOS 部署目标**：控制面通过 SSH 使用该 NAS 的 Docker 和 Docker Compose 运行应用。它不要求 NAS 运行 Kubernetes，也不把 NAS 的 Docker Socket 挂载给 Launchly API。

## 极空间 Z4 Pro 的建议

- 优先把 Z4 Pro 用作应用运行节点；控制面使用 Lite 画像时也可以同机运行，但本机构建会与 NAS 文件服务争抢 CPU、内存和磁盘 I/O。
- 使用已有 OCI 镜像或把构建转移到独立 Build Worker；Lite 默认不启动 BuildKit。不要在 NAS 上并发进行大型前端、Java 或多镜像构建。
- 为 Launchly 单独创建非 root 的 SSH 部署用户，并让它具备 Docker 使用权限；使用密钥认证和固定 Host Key。
- 在 NAS 的持久共享卷创建一个目录，例如 `/volume1/launchly`。实际挂载路径由设备/固件决定，必须以 SSH 中的真实绝对路径为准；不要填写 `/tmp`、缓存目录或仅 Web 管理员可写的路径。
- 在“部署目标 → 验证”中确认 Docker、Compose v2、架构、目录权限和磁盘余量均通过后再创建部署。验证不会自动信任未知 SSH 主机。

## 多项目、端口与域名

每次部署都使用 `<工作目录>/apps/<project>/<environment>/<deployment>`，并采用独立 Compose project。填写环境域名时，Runner 会在目标机启动一个共享 Nginx 容器和共享 Docker 网络，将不同域名路由到不同项目容器；应用的外部端口仅保留为回退访问/健康检查端口。

当前实现只自动维护 HTTP 路由。HTTPS、Let's Encrypt、路由切换与 NAS 上的真实外网域名验收仍未完成，不能把 HTTP 可访问视为 HTTPS 已可用。

## 发布前检查清单

1. NAS 已启用 SSH，且从 Launchly 控制面网络可访问。
2. 部署用户可执行 `docker info` 和 `docker compose version`，但不是 root。
3. SSH Host Key 已从 NAS 获取并固定到 Launchly；私钥只写入加密凭据，不使用密码登录。
4. Docker 的 80 端口未被 NAS 原有 Web/反向代理占用；若填写域名，Launchly 的共享 Nginx 需要该端口。
5. 工作目录位于可持久化卷，部署用户和 Docker 都有读写权限；预留应用镜像、日志和至少一个上一成功版本的空间。
6. 先用一个 OCI digest 镜像完成发布和回滚，再接入 Git 源码构建、域名和业务数据。

这份清单描述兼容性前置条件，不替代真实 NAS、DNS、Docker Registry、SSH 与 HTTP/HTTPS E2E 验收。
