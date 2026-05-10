<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>Release</h2>
        <p style="color: #8c8c8c;">查看发布历史、门禁状态和发布详情。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <a-select v-model:value="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadReleases">
          <a-select-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
        </a-select>
      </div>
    </div>

    <a-table :columns="columns" :data-source="releases" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/releases/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'gateStatus'">
          <a-tag :color="record.gateStatus === 'PASSED' ? 'green' : 'red'">{{ record.gateStatus || '-' }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/releases/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && releases.length === 0 && selectedProjectId" description="暂无 Release" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchProjects, fetchReleases } from '../api/client'

const columns = [
  { title: '版本', dataIndex: 'version' },
  { title: '环境', dataIndex: 'environmentId', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '门禁', dataIndex: 'gateStatus', key: 'gateStatus' },
  { title: '发布人', dataIndex: 'releasedBy' },
  { title: '发布时间', dataIndex: 'releasedAt' },
  { title: '操作', key: 'action' },
]

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const releases = ref<any[]>([])
const loading = ref(false)

function statusColor(s: string) {
  const map: Record<string, string> = { DRAFT: 'default', PENDING_GATES: 'processing', READY: 'success', PUBLISHED: 'blue', FAILED: 'red' }
  return map[s] || 'default'
}

async function loadReleases() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const res = await fetchReleases(selectedProjectId.value)
    releases.value = res.data
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
