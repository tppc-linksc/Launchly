# Launchly 开发指南

## 🚀 快速开始

### 一键启动（推荐）

```bash
./start-dev.sh
```

### 手动启动

```bash
# 1. 启动数据库
brew services start postgresql@16

# 2. 设置环境变量
export LAUNCHLY_JWT_SECRET="dev-jwt-hmac-key-change-in-production-at-least-48chars-JWT"
export LAUNCHLY_ENCRYPTION_KEY="dev-enc-seed-change-in-production-at-least-48chars-KEY"

# 3. 启动后端 API
cd services/api
mvn spring-boot:run

# 4. 新终端 - 启动前端
pnpm dev:web
```

## 📱 访问地址

- **前端**: http://localhost:5173
- **后端 API**: http://localhost:8080
- **健康检查**: http://localhost:8080/actuator/health

## 🗄️ 数据库

```bash
# 连接数据库
psql -U launchly -d launchly -h localhost

# 查看表
\dt

# 查看用户表
SELECT * FROM users;
```

## 🔧 开发命令

```bash
# 前端开发
cd apps/web
pnpm dev          # 启动开发服务器
pnpm build        # 构建生产版本

# 后端开发
cd services/api
mvn spring-boot:run    # 启动 API 服务
mvn test               # 运行测试
mvn clean package      # 打包

# Worker 服务
cd services/worker
mvn spring-boot:run    # 启动 Worker
```

## 📦 技术栈

### 前端
- Vue 3
- Vite
- Ant Design Vue
- TypeScript
- Pinia（状态管理）
- Vue Router

### 后端
- Spring Boot 3.3.0
- Spring Data JPA
- PostgreSQL 16
- Flyway（数据库迁移）
- JWT 认证
- SSH/JSch（部署功能）

### 工具
- Java 26
- Maven 3.9.16
- pnpm
- Homebrew

## 🏗️ 项目结构

```
Launchly/
├── apps/
│   └── web/                # Vue 3 前端应用
│       ├── src/
│       │   ├── api/        # API 客户端
│       │   ├── pages/      # 页面组件
│       │   ├── router/     # 路由配置
│       │   ├── stores/     # Pinia 状态
│       │   └── utils/      # 工具函数
│       └── package.json
├── services/
│   ├── api/                # Spring Boot API 服务
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── java/   # Java 源码
│   │   │   │   └── resources/
│   │   │   │       ├── application.yml
│   │   │   │       └── db/migration/  # Flyway 迁移
│   │   │   └── test/
│   │   └── pom.xml
│   └── worker/             # Spring Boot Worker 服务
├── cli/                    # Go CLI 工具
├── deploy/                 # 部署配置
├── docs/                   # 文档
├── scripts/                # 脚本工具
├── .env                    # 环境变量
├── .env.example            # 环境变量示例
├── package.json            # 根项目配置
├── pnpm-workspace.yaml     # pnpm 工作区配置
└── start-dev.sh            # 开发启动脚本
```

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

### 1. 端口被占用

```bash
# 查找占用端口的进程
lsof -i :5173
lsof -i :8080

# 杀死进程
kill -9 <PID>
```

### 2. 数据库连接失败

```bash
# 检查 PostgreSQL 状态
brew services list | grep postgresql

# 重启 PostgreSQL
brew services restart postgresql@16

# 检查数据库是否存在
psql -U launchly -d launchly -h localhost -c "SELECT 1;"
```

### 3. Maven 依赖下载慢

```bash
# 使用国内镜像（可选）
# 编辑 ~/.m2/settings.xml 添加阿里云镜像
```

### 4. 前端依赖安装失败

```bash
# 清除缓存
pnpm store prune

# 重新安装
rm -rf node_modules
pnpm install
```

## 📚 API 文档

启动后端后，可以访问：

- 健康检查: http://localhost:8080/actuator/health
- 应用信息: http://localhost:8080/actuator/info

## 🧪 测试

```bash
# 后端测试
cd services/api
mvn test

# 前端测试（如果配置了）
cd apps/web
pnpm test
```

## 📦 部署

### Docker 部署

```bash
# 构建镜像
docker-compose -f deploy/compose/docker-compose.yml build

# 启动服务
docker-compose -f deploy/compose/docker-compose.yml up -d
```

### 手动部署

参考 `deploy/` 目录下的配置文件。

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/your-feature`)
3. 提交更改 (`git commit -m 'Add some feature'`)
4. 推送到分支 (`git push origin feature/your-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🆘 获取帮助

- 查看 [README.md](README.md) 了解项目概述
- 查看 [docs/](docs/) 目录获取详细文档
- 提交 Issue 报告问题

---

**祝你开发愉快！** 🚀
