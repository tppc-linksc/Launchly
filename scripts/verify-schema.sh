#!/usr/bin/env bash
# verify-schema.sh —— BASE-04 验收：空库从 0 应用全部 migrations。
#
# 用法：
#   LAUNCHLY_DATABASE_URL=postgres://user:pass@host:5432/empty \
#   ./scripts/verify-schema.sh
#
# 期望：
#   - migrate deploy 顺序应用 7 个 migration，无错误。
#   - 二次运行显示 "No pending migrations to apply"（幂等）。

set -euo pipefail

if [[ -z "${LAUNCHLY_DATABASE_URL:-}" ]]; then
  echo "缺少 LAUNCHLY_DATABASE_URL" >&2
  exit 64
fi

API_DIR="$(cd "$(dirname "$0")/.." && pwd)/services/api"
cd "$API_DIR"

echo "[migrate] 首次应用所有 migrations"
npx prisma migrate deploy

echo "[migrate] 二次运行应当幂等"
npx prisma migrate deploy

echo "[verify-schema] OK"
