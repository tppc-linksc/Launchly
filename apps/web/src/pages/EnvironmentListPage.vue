<template>
  <div>
    <h2>环境管理</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">管理测试、预发、生产环境的端口、访问 URL、数据策略与环境变量。</p>

    <div style="margin-bottom: 16px;">
      <el-input v-model="searchProject" placeholder="搜索项目名称" clearable style="max-width: 300px;" />
    </div>

    <el-table :data="filteredEnvs" row-key="id" v-loading="loading">
      <el-table-column prop="projectId" label="所属项目" width="150">
        <template #default="{ row }">
          <a @click="$router.push(`/projects/${row.projectId}`)" style="cursor: pointer; color: var(--el-color-primary);">{{ projectNameMap[row.projectId] || '未知' }}</a>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="环境名称" />
      <el-table-column prop="type" label="类型" width="100">
        <template #default="{ row }">
          <el-tag :type="row.type === 'TEST' ? 'primary' : row.type === 'STAGING' ? 'warning' : 'danger'">{{ envTypeMap[row.type] || row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="deployMode" label="部署模式" width="120">
        <template #default="{ row }">
          <el-tag :type="row.deployMode === 'remote' ? 'warning' : ''">{{ deployModeMap[row.deployMode] || row.deployMode }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="externalPort" label="端口" width="80" />
      <el-table-column prop="url" label="URL" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '活跃' : '未激活' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用" width="70">
        <template #default="{ row }">
          <el-tag :type="row.enabled !== false ? 'success' : 'info'" size="small">{{ row.enabled !== false ? '已启用' : '已禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button link size="small" @click="openVarModal(row)">变量</el-button>
          <el-button link size="small" @click="openEditModal(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- Environment Variables Modal -->
    <el-dialog v-model="varModalOpen" :title="'环境变量 — ' + (selectedEnv?.name || '')" width="640px">
      <el-table :data="variables" row-key="id" size="small">
        <el-table-column prop="key" label="键" />
        <el-table-column label="值">
          <template #default="{ row }">
            <code>{{ row.maskedValue }}</code>
            <el-tag v-if="row.sensitive" type="warning" size="small" style="margin-left: 4px;">敏感</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-popconfirm title="确定删除此变量？" @confirm="doDeleteVar(row.id)">
              <template #reference>
                <el-button link type="danger" size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-divider />
      <el-form :model="newVar" inline @submit.prevent="addVar">
        <el-form-item><el-input v-model="newVar.key" placeholder="键" style="width: 150px" /></el-form-item>
        <el-form-item><el-input v-model="newVar.value" placeholder="值" style="width: 200px" /></el-form-item>
        <el-form-item><el-switch v-model="newVar.sensitive" active-text="敏感" inactive-text="普通" inline-prompt /></el-form-item>
        <el-form-item><el-button type="primary" :loading="adding" @click="addVar">添加</el-button></el-form-item>
      </el-form>
    </el-dialog>

    <!-- Edit Environment Modal -->
    <el-dialog v-model="editModalOpen" title="编辑环境配置">
      <el-form label-position="top">
        <el-form-item label="环境名称">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="部署模式">
          <el-radio-group v-model="editForm.deployMode">
            <el-radio value="local">本地部署（推荐）</el-radio>
            <el-radio value="remote" disabled>已弃用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="外部端口">
          <el-input-number v-model="editForm.externalPort" :min="1" :max="65535" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="访问地址 URL">
          <el-input v-model="editForm.url" placeholder="例如 http://localhost:3001" />
        </el-form-item>
        <el-form-item label="本地构建目录（可选）">
          <el-input v-model="editForm.localWorkRoot" placeholder="留空则使用 Worker 默认" />
        </el-form-item>
        <el-form-item label="数据策略">
          <el-select v-model="editForm.dataStrategy">
            <el-option value="isolated">隔离数据</el-option>
            <el-option value="sanitized">脱敏数据</el-option>
            <el-option value="real">真实数据</el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="editForm.enabled" active-text="启用" inactive-text="禁用" inline-prompt />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editModalOpen = false">取消</el-button>
        <el-button type="primary" :loading="editing" @click="handleEditSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchProjects, fetchEnvironments, fetchEnvVariables, createEnvVariable, deleteEnvVariable, updateEnvironment } from '../api/client'
import { envTypeMap, deployModeMap } from '../utils/display'

const route = useRoute()

const searchProject = ref('')

const projects = ref<any[]>([])
const envs = ref<any[]>([])
const loading = ref(false)

const projectNameMap = computed(() => {
  const map: Record<string, string> = {}
  projects.value.forEach(p => { map[p.id] = p.name })
  return map
})

const filteredEnvs = computed(() => {
  if (!searchProject.value) return envs.value
  const q = searchProject.value.toLowerCase()
  return envs.value.filter(e => {
    const name = projectNameMap.value[e.projectId] || ''
    return name.toLowerCase().includes(q)
  })
})

// Variable modal state
const varModalOpen = ref(false)
const selectedEnv = ref<any>(null)
const variables = ref<any[]>([])
const newVar = reactive({ key: '', value: '', sensitive: false })
const adding = ref(false)

// Edit modal state
const editModalOpen = ref(false)
const editing = ref(false)
const editForm = reactive({
  name: '', url: '', deployMode: 'local', localWorkRoot: '', externalPort: null as number | null, dataStrategy: 'isolated', enabled: true,
})

async function openVarModal(env: any) {
  selectedEnv.value = env
  varModalOpen.value = true
  try {
    const res = await fetchEnvVariables(env.id)
    variables.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
}

async function addVar() {
  if (!selectedEnv.value || !newVar.key || !newVar.value) return
  adding.value = true
  try {
    await createEnvVariable(selectedEnv.value.id, { key: newVar.key, value: newVar.value, sensitive: newVar.sensitive })
    newVar.key = ''; newVar.value = ''; newVar.sensitive = false
    const res = await fetchEnvVariables(selectedEnv.value.id)
    variables.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  adding.value = false
}

async function doDeleteVar(id: string) {
  if (!selectedEnv.value) return
  await deleteEnvVariable(selectedEnv.value.id, id)
  variables.value = variables.value.filter((v: any) => v.id !== id)
}

function openEditModal(env: any) {
  selectedEnv.value = env
  editForm.name = env.name || ''
  editForm.url = env.url || ''
  editForm.deployMode = env.deployMode === 'remote' ? 'local' : (env.deployMode || 'local')
  editForm.localWorkRoot = env.localWorkRoot || ''
  editForm.externalPort = env.externalPort || null
  editForm.dataStrategy = env.dataStrategy || 'isolated'
  editForm.enabled = env.enabled !== false
  editModalOpen.value = true
}

async function handleEditSave() {
  if (!selectedEnv.value) return
  editing.value = true
  try {
    await updateEnvironment(selectedEnv.value.id, { ...editForm })
    editModalOpen.value = false
    ElMessage.success('环境配置已更新')
    loadEnvs()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '更新失败')
  }
  editing.value = false
}

async function loadEnvs() {
  loading.value = true
  try {
    const projectsRes = await fetchProjects()
    projects.value = projectsRes.data || []
    const qp = route.query.projectId as string
    const targetProjects = qp
      ? projects.value.filter((p: any) => p.id === qp)
      : projects.value
    if (qp) searchProject.value = ''
    const allEnvs: any[] = []
    for (const p of targetProjects) {
      try {
        const eRes = await fetchEnvironments(p.id)
        allEnvs.push(...eRes.data)
      } catch (e) { ElMessage.error('操作失败，请稍后重试') }
    }
    envs.value = allEnvs
    // Auto-fill search box with project name when filtering by projectId
    if (qp && targetProjects.length === 1) {
      searchProject.value = targetProjects[0].name
    }
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
}

onMounted(() => { loadEnvs() })
</script>
