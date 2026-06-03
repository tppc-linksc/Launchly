<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>Issue 列表</h2>
        <p style="color: #8c8c8c;">管理测试失败等问题，指派、修复、复测。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadIssues">
          <el-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</el-option>
        </el-select>
        <el-button v-if="canWrite" type="primary" @click="showCreate = true" :disabled="!selectedProjectId">新建 Issue</el-button>
      </div>
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
      <el-select v-model="filterStatus" placeholder="状态筛选" style="width: 140px;" clearable @change="loadIssues">
        <el-option value="OPEN">{{ issueStatusMap.OPEN }}</el-option>
        <el-option value="ASSIGNED">{{ issueStatusMap.ASSIGNED }}</el-option>
        <el-option value="FIXING">{{ issueStatusMap.FIXING }}</el-option>
        <el-option value="FIXED">{{ issueStatusMap.FIXED }}</el-option>
        <el-option value="REOPENED">{{ issueStatusMap.REOPENED }}</el-option>
        <el-option value="CLOSED">{{ issueStatusMap.CLOSED }}</el-option>
      </el-select>
      <el-select v-model="filterPriority" placeholder="优先级" style="width: 120px;" clearable @change="loadIssues">
        <el-option value="P0">{{ priorityMap.P0 }}</el-option>
        <el-option value="P1">{{ priorityMap.P1 }}</el-option>
        <el-option value="P2">{{ priorityMap.P2 }}</el-option>
        <el-option value="P3">{{ priorityMap.P3 }}</el-option>
      </el-select>
    </div>

    <el-table :data="issues" row-key="id" v-loading="loading" @row-click="(row: any) => $router.push(`/issues/${selectedProjectId}/${row.id}`)" style="cursor: pointer;">
      <el-table-column prop="title" label="标题" />
      <el-table-column prop="priority" label="优先级">
        <template #default="{ row }">
          <el-tag :type="priorityType(row.priority)">{{ priorityMap[row.priority] || row.priority }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ issueStatusMap[row.status] || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="assigneeId" label="负责人" />
      <el-table-column prop="createdAt" label="创建时间" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button link @click.stop="$router.push(`/issues/${selectedProjectId}/${row.id}`)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && issues.length === 0 && selectedProjectId" description="暂无 Issue" />

    <!-- Create Modal -->
    <el-dialog v-model="showCreate" title="新建 Issue">
      <el-form label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="Issue 标题" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input type="textarea" v-model="form.description" :rows="3" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="form.priority">
            <el-option value="P0">{{ priorityMap.P0 }}</el-option>
            <el-option value="P1">{{ priorityMap.P1 }}</el-option>
            <el-option value="P2">{{ priorityMap.P2 }}</el-option>
            <el-option value="P3">{{ priorityMap.P3 }}</el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchProjects, fetchIssues, createIssue } from '../api/client'
import { usePermission } from '../composables/usePermission'

const route = useRoute()

const { canWrite } = usePermission()
import { issueStatusMap, priorityMap } from '../utils/display'

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const issues = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const filterStatus = ref('')
const filterPriority = ref('')
const form = ref({ title: '', description: '', priority: 'P2' })

function priorityType(p: string): '' | 'success' | 'info' | 'warning' | 'danger' {
  const map: Record<string, '' | 'success' | 'info' | 'warning' | 'danger'> = { P0: 'danger', P1: 'warning', P2: '', P3: 'info' }
  return map[p] || 'info'
}

function statusType(s: string): '' | 'success' | 'info' | 'warning' | 'danger' {
  const map: Record<string, '' | 'success' | 'info' | 'warning' | 'danger'> = {
    OPEN: 'info', ASSIGNED: '', FIXING: '', FIXED: 'success',
    REOPENED: 'warning', CLOSED: 'info'
  }
  return map[s] || 'info'
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
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
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
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  const qp = route.query.projectId as string
  if (qp) {
    selectedProjectId.value = qp
    loadIssues()
  }
})
</script>
