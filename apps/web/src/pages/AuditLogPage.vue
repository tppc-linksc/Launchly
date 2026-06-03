<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">审计日志</h2>
      <el-button @click="handleExport">导出 CSV</el-button>
    </div>
    <el-card>
      <el-table :data="logs" v-loading="loading" row-key="id" size="small">
        <el-table-column prop="userId" label="用户ID" show-overflow-tooltip />
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-tag>{{ auditActionMap[row.action] || row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="targetType" label="目标类型" width="120" />
        <el-table-column prop="targetId" label="目标ID" show-overflow-tooltip />
        <el-table-column label="详情" width="200">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 12px;">{{ row.detail || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="ipAddress" label="IP" width="130" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchAuditLogs } from '../api/client'
import { auditActionMap } from '../utils/display'

const logs = ref<any[]>([])
const loading = ref(false)

function formatTime(t: string) {
  if (!t) return '-'
  return new Date(t).toLocaleString()
}

function handleExport() {
  const url = '/api/audit-logs/export'
  const a = document.createElement('a')
  a.href = url
  a.download = 'audit-logs.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await fetchAuditLogs()
    logs.value = res.data || []
  } catch (e) { console.error(e) }
  loading.value = false
})
</script>
