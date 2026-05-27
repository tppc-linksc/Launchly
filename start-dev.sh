#!/bin/bash

# Launchly 开发环境启动脚本

echo "🚀 启动 Launchly 开发环境..."

# 加载环境变量
export LAUNCHLY_JWT_SECRET="dev-jwt-hmac-key-change-in-production-at-least-48chars-JWT"
export LAUNCHLY_ENCRYPTION_KEY="dev-enc-seed-change-in-production-at-least-48chars-KEY"

# 检查 PostgreSQL 是否运行
if ! brew services list | grep -q "postgresql@16.*started"; then
    echo "📦 启动 PostgreSQL..."
    brew services start postgresql@16
    sleep 2
fi

# 检查数据库是否存在
if ! psql -U launchly -d launchly -h localhost -c "SELECT 1;" > /dev/null 2>&1; then
    echo "🗄️ 创建数据库和用户..."
    psql postgres -c "CREATE USER launchly WITH PASSWORD 'launchly_dev_password';" 2>/dev/null
    psql postgres -c "CREATE DATABASE launchly OWNER launchly;" 2>/dev/null
fi

# 启动后端 API（后台运行）
echo "☕ 启动后端 API 服务..."
cd services/api
mvn spring-boot:run &
API_PID=$!
cd ../..

# 等待后端启动
echo "⏳ 等待后端服务启动..."
for i in {1..30}; do
    if curl -s http://localhost:8080/actuator/health > /dev/null 2>&1; then
        echo "✅ 后端 API 服务已启动: http://localhost:8080"
        break
    fi
    sleep 1
done

# 启动前端（后台运行）
echo "🎨 启动前端开发服务器..."
cd apps/web
pnpm dev &
WEB_PID=$!
cd ../..

# 等待前端启动
echo "⏳ 等待前端服务启动..."
for i in {1..15}; do
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        echo "✅ 前端服务已启动: http://localhost:5173"
        break
    fi
    sleep 1
done

echo ""
echo "🎉 Launchly 开发环境已启动！"
echo ""
echo "📱 前端: http://localhost:5173"
echo "🔌 后端 API: http://localhost:8080"
echo "📊 健康检查: http://localhost:8080/actuator/health"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待用户中断
trap "echo ''; echo '🛑 停止服务...'; kill $API_PID $WEB_PID 2>/dev/null; brew services stop postgresql@16; echo '✅ 已停止所有服务'; exit 0" INT TERM

wait
