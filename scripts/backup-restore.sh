#!/usr/bin/env bash
# backup-restore.sh —— 跑通 BASE-05 验收：备份 → 恢复到新库 → 迁移对齐 → 启动校验。
#
# 用法：
#   LAUNCHLY_DATABASE_URL=postgres://... \
#   LAUNCHLY_DB_BACKUP_URL=postgres://... \
#   ./scripts/backup-restore.sh
#
# 必需环境变量：
#   LAUNCHLY_DATABASE_URL  —— 现役数据库连接串。
#   LAUNCHLY_DB_BACKUP_URL —— 备份目标连接串（典型为空数据库或 CI 临时库）。
# 可选：
#   LAUNCHLY_PG_DUMP_BIN   —— 默认 pg_dump
#   LAUNCHLY_PG_RESTORE_BIN —— 默认 pg_restore

set -euo pipefail

if [[ -z "${LAUNCHLY_DATABASE_URL:-}" || -z "${LAUNCHLY_DB_BACKUP_URL:-}" ]]; then
  echo "缺少 LAUNCHLY_DATABASE_URL 或 LAUNCHLY_DB_BACKUP_URL" >&2
  exit 64
fi

PG_DUMP_BIN="${LAUNCHLY_PG_DUMP_BIN:-pg_dump}"
PG_RESTORE_BIN="${LAUNCHLY_PG_RESTORE_BIN:-pg_restore}"
BACKUP_FILE="$(mktemp -t launchly-backup-XXXXXX.sql)"
trap 'rm -f "$BACKUP_FILE"' EXIT

echo "[backup] 正在导出 $LAUNCHLY_DATABASE_URL"
"$PG_DUMP_BIN" --no-owner --clean --if-exists "$LAUNCHLY_DATABASE_URL" > "$BACKUP_FILE"

echo "[restore] 正在恢复到 $LAUNCHLY_DB_BACKUP_URL"
"$PG_RESTORE_BIN" --no-owner --clean --if-exists --dbname "$LAUNCHLY_DB_BACKUP_URL" "$BACKUP_FILE"

echo "[verify] 在备份目标上执行 Prisma migration deploy"
LAUNCHLY_DATABASE_URL="$LAUNCHLY_DB_BACKUP_URL" \
  npx --yes prisma migrate deploy

echo "[backup-restore] OK"
