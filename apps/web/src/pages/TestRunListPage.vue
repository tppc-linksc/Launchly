<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>测试任务</h2>
        <p style="color: #8c8c8c;">查看所有测试任务及其执行状态。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <a-select v-model:value="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadTestRuns">
          <a-select-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
        </a-select>
      </div>
    </div>

    <a-table :columns="columns" :data-source="testRuns" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/tests/runs/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/tests/runs/${record.id}`)">执行</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && testRuns.length === 0 && selectedProjectId" description="暂无测试任务" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchProjects, fetchTestRuns } from '../api/client'

const columns = [
  { title: '关联部署', dataIndex: 'deploymentId', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '创建人', dataIndex: 'createdBy' },
  { title: '创建时间', dataIndex: 'createdAt' },
  { title: '完成时间', dataIndex: 'finishedAt' },
  { title: '操作', key: 'action' },
]

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const testRuns = ref<any[]>([])
const loading = ref(false)

function statusColor(s: string) {
  const map: Record<string, string> = { PENDING: 'default', RUNNING: 'processing', COMPLETED: 'success' }
  return map[s] || 'default'
}

async function loadTestRuns() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const res = await fetchTestRuns(selectedProjectId.value)
    testRuns.value = res.data
  } catch {}
  loading.value = false
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch {}
})
</script>
