<template>
  <div>
    <h2>审计日志</h2>
    <a-card style="margin-top: 16px;">
      <a-table :columns="columns" :data-source="logs" :loading="loading" row-key="id" size="small">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-tag>{{ auditActionMap[record.action] || record.action }}</a-tag>
          </template>
          <template v-if="column.key === 'detail'">
            <span style="font-family: monospace; font-size: 12px;">{{ record.detail || '-' }}</span>
          </template>
          <template v-if="column.key === 'createdAt'">
            {{ formatTime(record.createdAt) }}
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchAuditLogs } from '../api/client'
import { auditActionMap } from '../utils/display'

const logs = ref<any[]>([])
const loading = ref(false)

const columns = [
  { title: '用户ID', dataIndex: 'userId', ellipsis: true },
  { title: '操作', dataIndex: 'action', key: 'action', width: 160 },
  { title: '目标类型', dataIndex: 'targetType', width: 120 },
  { title: '目标ID', dataIndex: 'targetId', ellipsis: true },
  { title: '详情', dataIndex: 'detail', key: 'detail', width: 200 },
  { title: 'IP', dataIndex: 'ipAddress', width: 130 },
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
]

function formatTime(t: string) {
  if (!t) return '-'
  return new Date(t).toLocaleString()
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
