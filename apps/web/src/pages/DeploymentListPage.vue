<template>
  <div>
    <h2>部署记录</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">当前工作空间内的全部部署记录（不限于单个项目）。从项目详情触发部署后，可在此查看历史与状态。</p>
    <a-table :columns="columns" :data-source="deployments" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/deployments/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ deployStatusMap[record.status] || record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/deployments/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && deployments.length === 0" description="暂无部署记录" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchDeployments } from '../api/client'
import { deployStatusMap } from '../utils/display'

const columns = [
  { title: '分支', dataIndex: 'branch' },
  { title: 'Commit', dataIndex: 'commitSha', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '触发人', dataIndex: 'triggeredBy' },
  { title: '创建时间', dataIndex: 'createdAt' },
  { title: '操作', key: 'action' },
]

const deployments = ref<any[]>([])
const loading = ref(false)

function statusColor(s: string) {
  const map: Record<string, string> = {
    PENDING: 'default', RUNNING: 'processing', SUCCEEDED: 'success',
    FAILED: 'error', CANCELED: 'warning',
  }
  return map[s] || 'default'
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await fetchDeployments()
    deployments.value = res.data
  } catch {}
  loading.value = false
})
</script>
