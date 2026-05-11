<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>Issue 列表</h2>
        <p style="color: #8c8c8c;">管理测试失败等问题，指派、修复、复测。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <a-select v-model:value="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadIssues">
          <a-select-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
        </a-select>
        <a-button type="primary" @click="showCreate = true" :disabled="!selectedProjectId">新建 Issue</a-button>
      </div>
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <a-select v-model:value="filterStatus" placeholder="状态筛选" style="width: 140px;" allow-clear @change="loadIssues">
        <a-select-option value="OPEN">{{ issueStatusMap.OPEN }}</a-select-option>
        <a-select-option value="ASSIGNED">{{ issueStatusMap.ASSIGNED }}</a-select-option>
        <a-select-option value="FIXING">{{ issueStatusMap.FIXING }}</a-select-option>
        <a-select-option value="FIXED">{{ issueStatusMap.FIXED }}</a-select-option>
        <a-select-option value="REOPENED">{{ issueStatusMap.REOPENED }}</a-select-option>
        <a-select-option value="CLOSED">{{ issueStatusMap.CLOSED }}</a-select-option>
      </a-select>
      <a-select v-model:value="filterPriority" placeholder="优先级" style="width: 120px;" allow-clear @change="loadIssues">
        <a-select-option value="P0">{{ priorityMap.P0 }}</a-select-option>
        <a-select-option value="P1">{{ priorityMap.P1 }}</a-select-option>
        <a-select-option value="P2">{{ priorityMap.P2 }}</a-select-option>
        <a-select-option value="P3">{{ priorityMap.P3 }}</a-select-option>
      </a-select>
    </div>

    <a-table :columns="columns" :data-source="issues" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/issues/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'priority'">
          <a-tag :color="priorityColor(record.priority)">{{ priorityMap[record.priority] || record.priority }}</a-tag>
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ issueStatusMap[record.status] || record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/issues/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && issues.length === 0 && selectedProjectId" description="暂无 Issue" />

    <!-- Create Modal -->
    <a-modal v-model:open="showCreate" title="新建 Issue" @ok="handleSave">
      <a-form layout="vertical">
        <a-form-item label="标题" required>
          <a-input v-model:value="form.title" placeholder="Issue 标题" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="form.description" :rows="3" />
        </a-form-item>
        <a-form-item label="优先级">
          <a-select v-model:value="form.priority">
            <a-select-option value="P0">{{ priorityMap.P0 }}</a-select-option>
            <a-select-option value="P1">{{ priorityMap.P1 }}</a-select-option>
            <a-select-option value="P2">{{ priorityMap.P2 }}</a-select-option>
            <a-select-option value="P3">{{ priorityMap.P3 }}</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchProjects, fetchIssues, createIssue } from '../api/client'
import { issueStatusMap, priorityMap } from '../utils/display'

const columns = [
  { title: '标题', dataIndex: 'title' },
  { title: '优先级', dataIndex: 'priority', key: 'priority' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '负责人', dataIndex: 'assigneeId' },
  { title: '创建时间', dataIndex: 'createdAt' },
  { title: '操作', key: 'action' },
]

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const issues = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const filterStatus = ref('')
const filterPriority = ref('')
const form = ref({ title: '', description: '', priority: 'P2' })

function priorityColor(p: string) {
  const map: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' }
  return map[p] || 'default'
}

function statusColor(s: string) {
  const map: Record<string, string> = {
    OPEN: 'default', ASSIGNED: 'blue', FIXING: 'processing', FIXED: 'success',
    REOPENED: 'warning', CLOSED: 'default'
  }
  return map[s] || 'default'
}

async function loadIssues() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const params: any = {}
    if (filterStatus.value) params.status = filterStatus.value
    if (filterPriority.value) params.priority = filterPriority.value
    const res = await fetchIssues(selectedProjectId.value, params)
    issues.value = res.data
  } catch {}
  loading.value = false
}

async function handleSave() {
  try {
    await createIssue(selectedProjectId.value, form.value)
    showCreate.value = false
    form.value = { title: '', description: '', priority: 'P2' }
    loadIssues()
  } catch (e) { console.error(e) }
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch {}
})
</script>
