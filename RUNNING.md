# Launchly 运行指南

本项目支持两种运行方式：**Docker 运行**和**本地运行**。

## 🐳 Docker 运行（推荐）

### 优点
- ✅ 一键启动所有服务
- ✅ 环境隔离，不污染本地环境
- ✅ 环境一致性好
- ✅ 适合快速体验和生产部署

### 缺点
- ❌ 首次构建需要下载镜像（约 5-10 分钟）
- ❌ 调试相对麻烦
- ❌ 在 Mac ARM 上有性能损耗（QEMU 模拟）

### 快速启动

```bash
# 1. 确保 Docker 已安装并运行
docker --version

# 2. 启动所有服务
cd deploy/compose
docker-compose up -d

# 3. 查看服务状态
docker ps

# 4. 访问应用
# 前端: http://localhost:5173（需要本地启动）
# 后端 API: http://localhost:8080
# 健康检查: http://localhost:8080/actuator/health
```

### 常用命令

```bash
# 查看日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f app
docker-compose logs -f worker
docker-compose logs -f postgres

# 停止服务
docker-compose down

# 重新构建并启动
docker-compose up -d --build

# 进入容器调试
docker exec -it launchly-app sh
docker exec -it launchly-postgres psql -U launchly -d launchly
```

## 💻 本地运行

### 优点
- ✅ 调试方便
- ✅ 性能好
- ✅ 热重载支持好
- ✅ 适合开发

### 缺点
- ❌ 需要手动安装依赖
- ❌ 可能污染本地环境
- ❌ 环境配置复杂

### 前置要求

- Java 17+
- Maven 3.9+
- Node.js 18+
- pnpm
- PostgreSQL 16

### 快速启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动数据库（使用 Docker）
docker-compose up -d postgres

# 或者使用本地 PostgreSQL
brew services start postgresql@16
psql postgres -c "CREATE USER launchly WITH PASSWORD 'launchly_dev_password';"
psql postgres -c "CREATE DATABASE launchly OWNER launchly;"

# 3. 设置环境变量
export LAUNCHLY_JWT_SECRET="dev-jwt-hmac-key-change-in-production-at-least-48chars-JWT"
export LAUNCHLY_ENCRYPTION_KEY="dev-enc-seed-change-in-production-at-least-48chars-KEY"

# 4. 启动后端 API
cd services/api
mvn spring-boot:run

# 5. 启动前端（新终端）
pnpm dev:web
```

### 常用命令

```bash
# 启动前端
pnpm dev:web

# 启动后端 API
cd services/api && mvn spring-boot:run

# 启动 Worker
cd services/worker && mvn spring-boot:run

# 数据库管理
psql -U launchly -d launchly -h localhost

# 查看端口占用
lsof -i :5173
lsof -i :8080
```

## 🔧 一键启动脚本

我们提供了启动脚本，方便快速启动开发环境：

```bash
./start-dev.sh
```

这个脚本会：
1. 检查并启动 PostgreSQL（Docker 或本地）
2. 设置环境变量
3. 启动后端 API
4. 启动前端

## 📊 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 | 5173 | Vue 3 开发服务器 |
| 后端 API | 8080 | Spring Boot API |
| PostgreSQL | 5432 | 数据库 |

## 🔐 安全配置

### 开发环境

开发环境使用默认密钥，仅用于本地开发：

```bash
LAUNCHLY_JWT_SECRET="dev-jwt-hmac-key-change-in-production-at-least-48chars-JWT"
LAUNCHLY_ENCRYPTION_KEY="dev-enc-seed-change-in-production-at-least-48chars-KEY"
```

### 生产环境

生产环境必须设置强密钥：

```bash
# 生成随机密钥
openssl rand -base64 48

# 设置环境变量
export LAUNCHLY_JWT_SECRET="your-strong-jwt-secret-here"
export LAUNCHLY_ENCRYPTION_KEY="your-strong-encryption-key-here"
```

## 🐛 常见问题

### 1. Docker 构建失败

```bash
# 清理 Docker 缓存
docker system prune -a

# 重新构建
docker-compose build --no-cache
```

### 2. 端口被占用

```bash
# 查找占用端口的进程
lsof -i :5173
lsof -i :8080

# 杀死进程
kill -9 <PID>
```

### 3. 数据库连接失败

```bash
# 检查 PostgreSQL 状态
docker ps | grep postgres

# 重启 PostgreSQL
docker-compose restart postgres

# 检查数据库连接
docker exec -it launchly-postgres psql -U launchly -d launchly -c "SELECT 1;"
```

### 4. 本地依赖安装失败

```bash
# 清除 pnpm 缓存
pnpm store prune

# 重新安装
rm -rf node_modules
pnpm install
```

## 📚 相关文档

- [README.md](README.md) - 项目概述
- [DEV.md](DEV.md) - 开发指南
- [SETUP_STATUS.md](SETUP_STATUS.md) - 配置状态

## 🎯 推荐方式

### 开发者（推荐本地运行）

```bash
# 1. 克隆项目
git clone git@github.com:tppc-linksc/Launchly.git
cd Launchly

# 2. 启动数据库（Docker）
docker-compose up -d postgres

# 3. 安装依赖
pnpm install

# 4. 启动服务
./start-dev.sh
```

### 快速体验（推荐 Docker）

```bash
# 1. 克隆项目
git clone git@github.com:tppc-linksc/Launchly.git
cd Launchly

# 2. 启动所有服务
cd deploy/compose
docker-compose up -d

# 3. 访问应用
open http://localhost:8080
```

## 🔄 切换运行方式

### 从本地切换到 Docker

```bash
# 1. 停止本地服务
kill $(lsof -t -i:8080) 2>/dev/null
kill $(lsof -t -i:5173) 2>/dev/null
brew services stop postgresql@16

# 2. 启动 Docker 服务
docker-compose up -d
```

### 从 Docker 切换到本地

```bash
# 1. 停止 Docker 服务
docker-compose down

# 2. 启动本地服务
./start-dev.sh
```

---

**选择适合你的方式开始开发吧！** 🚀
