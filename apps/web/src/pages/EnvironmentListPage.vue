<template>
  <div>
    <h2>环境管理</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">管理测试、预发、生产环境的端口、访问 URL、数据策略与环境变量。</p>

    <div style="margin-bottom: 16px;">
      <a-input v-model:value="searchProject" placeholder="搜索项目名称" allow-clear style="max-width: 300px;" />
    </div>

    <a-table :columns="columns" :data-source="filteredEnvs" row-key="id" :loading="loading" :pagination="{ pageSize: 20 }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'project'">
          <a @click="$router.push(`/projects/${record.projectId}`)">{{ projectNameMap[record.projectId] || '未知' }}</a>
        </template>
        <template v-if="column.key === 'type'">
          <a-tag :color="record.type === 'TEST' ? 'blue' : record.type === 'STAGING' ? 'orange' : 'red'">{{ envTypeMap[record.type] || record.type }}</a-tag>
        </template>
        <template v-if="column.key === 'deployMode'">
          <a-tag :color="record.deployMode === 'remote' ? 'warning' : 'processing'">{{ deployModeMap[record.deployMode] || record.deployMode }}</a-tag>
        </template>
        <template v-if="column.key === 'status'">
          <a-badge :status="record.status === 'active' ? 'success' : 'default'" :text="record.status === 'active' ? '活跃' : '未激活'" />
        </template>
        <template v-if="column.key === 'enabled'">
          <a-tag :color="record.enabled !== false ? 'green' : 'default'">{{ record.enabled !== false ? '已启用' : '已禁用' }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="openVarModal(record)">变量</a-button>
          <a-button type="link" size="small" @click="openEditModal(record)">编辑</a-button>
        </template>
      </template>
    </a-table>

    <!-- Environment Variables Modal -->
    <a-modal :open="varModalOpen" :title="'环境变量 — ' + (selectedEnv?.name || '')" width="640px" @cancel="varModalOpen = false" :footer="null">
      <a-table :columns="varColumns" :data-source="variables" row-key="id" size="small" :pagination="false">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'value'">
            <code>{{ record.maskedValue }}</code>
            <a-tag v-if="record.sensitive" color="warning" style="margin-left: 4px;">敏感</a-tag>
          </template>
          <template v-if="column.key === 'varAction'">
            <a-popconfirm title="确定删除此变量？" @confirm="doDeleteVar(record.id)">
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
      <a-divider />
      <a-form :model="newVar" layout="inline" @finish="addVar">
        <a-form-item><a-input v-model:value="newVar.key" placeholder="键" style="width: 150px" /></a-form-item>
        <a-form-item><a-input v-model:value="newVar.value" placeholder="值" style="width: 200px" /></a-form-item>
        <a-form-item><a-switch v-model:checked="newVar.sensitive" checked-children="敏感" un-checked-children="普通" /></a-form-item>
        <a-form-item><a-button type="primary" html-type="submit" :loading="adding">添加</a-button></a-form-item>
      </a-form>
    </a-modal>

    <!-- Edit Environment Modal -->
    <a-modal v-model:open="editModalOpen" title="编辑环境配置" @ok="handleEditSave" :confirm-loading="editing">
      <a-form layout="vertical">
        <a-form-item label="环境名称">
          <a-input v-model:value="editForm.name" />
        </a-form-item>
        <a-form-item label="部署模式">
          <a-radio-group v-model:value="editForm.deployMode">
            <a-radio value="local">本地部署（推荐）</a-radio>
            <a-radio value="remote" disabled>已弃用</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="外部端口">
          <a-input-number v-model:value="editForm.externalPort" :min="1" :max="65535" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="访问地址 URL">
          <a-input v-model:value="editForm.url" placeholder="例如 http://localhost:3001" />
        </a-form-item>
        <a-form-item label="本地构建目录（可选）">
          <a-input v-model:value="editForm.localWorkRoot" placeholder="留空则使用 Worker 默认" />
        </a-form-item>
        <a-form-item label="数据策略">
          <a-select v-model:value="editForm.dataStrategy">
            <a-select-option value="isolated">隔离数据</a-select-option>
            <a-select-option value="sanitized">脱敏数据</a-select-option>
            <a-select-option value="real">真实数据</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="启用状态">
          <a-switch v-model:checked="editForm.enabled" checked-children="启用" un-checked-children="禁用" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { fetchProjects, fetchEnvironments, fetchEnvVariables, createEnvVariable, deleteEnvVariable, updateEnvironment } from '../api/client'
import { envTypeMap, deployModeMap } from '../utils/display'

const searchProject = ref('')

const columns = [
  { title: '所属项目', key: 'project', dataIndex: 'projectId', width: 150 },
  { title: '环境名称', dataIndex: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
  { title: '部署模式', dataIndex: 'deployMode', key: 'deployMode', width: 120 },
  { title: '端口', dataIndex: 'externalPort', width: 80 },
  { title: 'URL', dataIndex: 'url', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status', width: 80 },
  { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 70 },
  { title: '操作', key: 'action', width: 120 },
]

const varColumns = [
  { title: '键', dataIndex: 'key' },
  { title: '值', key: 'value' },
  { title: '操作', key: 'varAction', width: 80 },
]

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
  } catch {}
}

async function addVar() {
  if (!selectedEnv.value || !newVar.key || !newVar.value) return
  adding.value = true
  try {
    await createEnvVariable(selectedEnv.value.id, { key: newVar.key, value: newVar.value, sensitive: newVar.sensitive })
    newVar.key = ''; newVar.value = ''; newVar.sensitive = false
    const res = await fetchEnvVariables(selectedEnv.value.id)
    variables.value = res.data
  } catch {}
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
    message.success('环境配置已更新')
    loadEnvs()
  } catch (e: any) {
    message.error(e.response?.data?.message || '更新失败')
  }
  editing.value = false
}

async function loadEnvs() {
  loading.value = true
  try {
    const projectsRes = await fetchProjects()
    projects.value = projectsRes.data || []
    const allEnvs: any[] = []
    for (const p of projects.value) {
      try {
        const eRes = await fetchEnvironments(p.id)
        allEnvs.push(...eRes.data)
      } catch {}
    }
    envs.value = allEnvs
  } catch {}
  loading.value = false
}

onMounted(() => { loadEnvs() })
</script>
