<template>
  <div>
    <h2>环境管理</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">管理测试、预发、生产环境的端口、访问 URL、数据策略与环境变量。云上机器通过项目页的「部署目标」连接，不在此页配置 SSH。</p>
    <a-table :columns="columns" :data-source="envs" row-key="id" :loading="loading">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'localWorkRoot'">
          <span v-if="record.localWorkRoot" :title="record.localWorkRoot">{{ record.localWorkRoot }}</span>
          <span v-else style="color: #bfbfbf;">默认</span>
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
            <a-radio value="remote" disabled>环境内「远程直连」（已弃用）</a-radio>
          </a-radio-group>
          <div style="font-size: 12px; color: #8c8c8c; margin-top: 6px;">
            云上服务器请使用项目详情里的「部署目标」+ SSH，不要选此项。此处「本地部署」仅表示：Worker 在本机用 Docker 构建后，再把镜像推到您填的部署目标。
          </div>
        </a-form-item>
        <template v-if="editForm.deployMode === 'local'">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px;"
            message="端口、访问 URL、本地构建目录在此配置；SSH 主机与密钥请在项目页「部署目标」添加并验证。"
          />
          <a-form-item label="本地构建目录（可选）">
            <a-input
              v-model:value="editForm.localWorkRoot"
              placeholder="留空则使用 Worker 默认：/tmp/launchly-builds"
            />
            <div style="font-size: 12px; color: #8c8c8c; margin-top: 4px;">
              指定后，源码与 compose 会写在「该目录 / 项目ID / 部署ID」下；需 Worker 进程可读写。与下方「远程部署目录」不同：后者仅在选择 BYOS 远程分发时使用。
            </div>
          </a-form-item>
        </template>
        <template v-if="editForm.deployMode === 'remote'">
          <a-alert type="warning" show-icon style="margin-bottom: 12px;">
            <template #message>
              <span>该环境仍为旧版「remote」标记。请改选上方「本地部署」并保存，然后在项目内使用「部署目标」部署到云服务器。</span>
            </template>
          </a-alert>
          <a-form-item label="主机地址">
            <a-input v-model:value="editForm.host" placeholder="例如 192.168.1.100" :disabled="true" />
          </a-form-item>
          <a-form-item label="SSH 用户">
            <a-input v-model:value="editForm.sshUser" placeholder="例如 root" :disabled="true" />
          </a-form-item>
          <a-form-item label="远程部署目录（BYOS）">
            <a-input v-model:value="editForm.deployDir" placeholder="例如远程机上的 /opt/launchly/..." :disabled="true" />
          </a-form-item>
        </template>
        <a-form-item label="外部端口">
          <a-input-number v-model:value="editForm.externalPort" :min="1" :max="65535" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="访问地址 URL">
          <a-input v-model:value="editForm.url" placeholder="例如 http://localhost:3001" />
          <div v-if="editForm.deployMode === 'local'" style="font-size: 12px; color: #8c8c8c; margin-top: 4px;">
            测试、验收时请填团队能打开的地址；与「外部端口」一致时通常为本机 http://localhost:端口。
          </div>
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
import { ref, reactive } from 'vue'
import { message } from 'ant-design-vue'
import { fetchProjects, fetchEnvironments, fetchEnvVariables, createEnvVariable, deleteEnvVariable, updateEnvironment } from '../api/client'
import { envTypeMap, deployModeMap } from '../utils/display'

const columns = [
  { title: '环境名称', dataIndex: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
  { title: '部署模式', dataIndex: 'deployMode', key: 'deployMode', width: 120 },
  { title: '外部端口', dataIndex: 'externalPort', width: 90 },
  { title: '本地构建根', dataIndex: 'localWorkRoot', key: 'localWorkRoot', ellipsis: true, width: 160 },
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

const envs = ref<any[]>([])
const loading = ref(false)

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
  name: '', url: '', deployMode: 'local', host: '', sshUser: '',
  deployDir: '', localWorkRoot: '', externalPort: null as number | null, dataStrategy: 'isolated', enabled: true,
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
  const mode = env.deployMode || 'local'
  if (mode === 'remote') {
    editForm.deployMode = 'local'
    message.warning('该环境曾为「远程」模式，已自动切换为「本地部署」以配合部署目标（BYOS）。请核对端口与 URL 后保存。')
  } else {
    editForm.deployMode = mode
  }
  editForm.host = env.host || ''
  editForm.sshUser = env.sshUser || ''
  editForm.deployDir = env.deployDir || ''
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
    const payload = { ...editForm }
    if (payload.deployMode === 'remote') {
      payload.deployMode = 'local'
    }
    await updateEnvironment(selectedEnv.value.id, payload)
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
    const allEnvs: any[] = []
    for (const p of projectsRes.data) {
      try {
        const eRes = await fetchEnvironments(p.id)
        allEnvs.push(...eRes.data)
      } catch {}
    }
    envs.value = allEnvs
  } catch {}
  loading.value = false
}

loadEnvs()
</script>
