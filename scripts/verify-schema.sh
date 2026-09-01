#!/usr/bin/env bash
# verify-schema.sh —— BASE-04 验收：空库从 0 应用全部 migrations。
#
# 用法：
#   LAUNCHLY_DATABASE_URL=postgres://user:pass@host:5432/empty \
#   ./scripts/verify-schema.sh
#
# 期望：
#   - migrate deploy 顺序应用仓库内全部 migration，无错误。
#   - 二次运行显示 "No pending migrations to apply"（幂等）。
#   - 配置 LAUNCHLY_SHADOW_DATABASE_URL 时，migration 历史与 schema.prisma 无漂移。

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

if [[ -n "${LAUNCHLY_SHADOW_DATABASE_URL:-}" ]]; then
  echo "[schema-diff] migration 历史必须与 schema.prisma 一致"
  npx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url "$LAUNCHLY_SHADOW_DATABASE_URL" \
    --exit-code
elif [[ "${LAUNCHLY_REQUIRE_SCHEMA_DIFF:-0}" == "1" ]]; then
  echo "缺少 LAUNCHLY_SHADOW_DATABASE_URL，无法执行 schema drift 门禁" >&2
  exit 64
else
  echo "[schema-diff] 未配置 shadow database，本地跳过；CI 必须强制执行"
fi

echo "[verify-schema] OK"
