# node-hello — Launchly 示例项目

最小 Node.js 应用，用于验证 Launchly 部署流程。

## 本地运行

```bash
npm install
npm start
# 访问 http://localhost:3000
```

## 部署到 Launchly

1. 将此目录推送到 Git 仓库（GitHub / GitLab / 自建 Git）
2. 在 Launchly 中创建项目，连接该仓库
3. 添加部署目标（SSH 服务器）
4. 触发部署

## 端点

- `GET /` — 返回 JSON 状态信息
- `GET /health` — 健康检查端点（Launchly 会调用此端点验证部署成功）
