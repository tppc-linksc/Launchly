<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>发布管理</h2>
        <p style="color: #8c8c8c;">查看发布历史、门禁状态和发布详情。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <a-select v-model:value="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadReleases">
          <a-select-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
        </a-select>
        <a-button type="primary" @click="showCreate = true" :disabled="!selectedProjectId">新建 Release</a-button>
      </div>
    </div>

    <a-table :columns="columns" :data-source="releases" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/releases/${selectedProjectId}/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ releaseStatusMap[record.status] || record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'gateStatus'">
          <a-tag :color="record.gateStatus === 'PASSED' ? 'green' : 'red'">{{ record.gateStatus === 'PASSED' ? '通过' : record.gateStatus === 'FAILED' ? '失败' : record.gateStatus || '-' }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/releases/${selectedProjectId}/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && releases.length === 0 && selectedProjectId" description="暂无 Release" />

    <!-- Create Modal -->
    <a-modal v-model:open="showCreate" title="新建 Release" @ok="handleCreate">
      <a-form layout="vertical">
        <a-form-item label="版本号" required>
          <a-input v-model:value="form.version" placeholder="例如 1.0.0" />
        </a-form-item>
        <a-form-item label="关联部署">
          <a-select v-model:value="form.deploymentId" placeholder="选择部署" allow-clear>
            <a-select-option v-for="d in deployments" :key="d.id" :value="d.id">{{ d.branch }} ({{ d.createdAt?.slice(0, 10) }})</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="发布说明">
          <a-textarea v-model:value="form.notes" :rows="3" placeholder="发布说明" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchProjects, fetchReleases, fetchDeployments, createRelease } from '../api/client'
import { releaseStatusMap } from '../utils/display'

const route = useRoute()

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
const deployments = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const form = ref({ version: '', deploymentId: '', notes: '' })

function statusColor(s: string) {
  const map: Record<string, string> = { DRAFT: 'default', PENDING_GATES: 'processing', READY: 'success', PUBLISHED: 'blue', FAILED: 'red' }
  return map[s] || 'default'
}

async function loadReleases() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const [relRes, depRes] = await Promise.all([
      fetchReleases(selectedProjectId.value),
      fetchDeployments({ projectId: selectedProjectId.value }),
    ])
    releases.value = relRes.data
    deployments.value = (depRes.data || []).filter((d: any) => d.status === 'SUCCEEDED')
  } catch (e) { message.error('操作失败，请稍后重试') }
  loading.value = false
}

async function handleCreate() {
  try {
    await createRelease(selectedProjectId.value, form.value)
    showCreate.value = false
    form.value = { version: '', deploymentId: '', notes: '' }
    loadReleases()
  } catch (e: any) { console.error(e) }
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch (e) { message.error('操作失败，请稍后重试') }
  const qp = route.query.projectId as string
  if (qp) {
    selectedProjectId.value = qp
    loadReleases()
  }
})
</script>
