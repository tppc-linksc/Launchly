<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">部署目标</h2>
      <el-space>
        <el-input v-model="searchText" placeholder="搜索项目或目标名称" style="width: 240px;" clearable />
        <el-button v-if="canWrite" type="primary" @click="openCreate">添加部署目标</el-button>
      </el-space>
    </div>

    <el-card>
      <el-table :data="filteredTargets" v-loading="loading" row-key="id" size="default">
        <el-table-column prop="projectName" label="所属项目" width="150">
          <template #default="{ row }">
            <router-link :to="`/projects/${row.projectId}`">{{ row.projectName }}</router-link>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="type" label="类型">
          <template #default="{ row }">
            <el-tag>{{ typeMap[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="host" label="主机" />
        <el-table-column prop="port" label="端口" />
        <el-table-column prop="username" label="用户" />
        <el-table-column prop="workRoot" label="工作目录" min-width="180" show-overflow-tooltip />
        <el-table-column prop="authMethod" label="认证">
          <template #default="{ row }">
            <el-tag type="primary">密钥</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态">
          <template #default="{ row }">
            <el-tag :type="row.status === 'VERIFIED' || row.status === 'CONNECTED' ? 'success' : row.status === 'FAILED' ? 'danger' : 'warning'" size="small">
              {{ statusMap[row.status] || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastVerifiedAt" label="最后验证">
          <template #default="{ row }">
            <span v-if="row.lastVerifiedAt">{{ formatDateTime(row.lastVerifiedAt) }}</span>
            <span v-else style="color: #999;">未验证</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-space>
              <el-button v-if="canWrite" size="small" @click="verify(row)">验证</el-button>
              <el-button v-if="canWrite" size="small" @click="openEdit(row)">编辑</el-button>
              <el-popconfirm v-if="canWrite" title="确定删除此部署目标？" @confirm="doDelete(row.id)">
                <template #reference>
                  <el-button size="small" type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && filteredTargets.length === 0" description="暂无部署目标" />
    </el-card>

    <!-- Create / Edit Modal -->
    <el-dialog v-model="modalOpen" :title="editingId ? '编辑部署目标' : '添加部署目标'">
      <el-form label-position="top" :model="form">
        <el-form-item v-if="!editingId" label="所属项目" required>
          <el-select v-model="form.projectId" placeholder="选择项目">
            <el-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="生产服务器、测试节点等" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="form.type">
            <el-option value="SSH">BYOS SSH</el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="主机地址" required>
          <el-input v-model="form.host" placeholder="192.168.1.100 或 example.com" />
        </el-form-item>
        <el-form-item label="SSH 端口">
          <el-input-number v-model="form.port" :min="1" :max="65535" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" placeholder="deploy（禁止使用 root）" />
        </el-form-item>
        <el-form-item label="Launchly 工作目录">
          <el-input v-model="form.workRoot" placeholder="/var/lib/launchly" />
          <span style="font-size: 11px; color: #8c8c8c;">Linux 默认目录。NAS 可填写已创建且 SSH 用户与 Docker 都能读写的共享目录，例如挂载卷中的 <code>/volume1/launchly</code>；不使用临时目录。</span>
        </el-form-item>
        <el-form-item label="SSH 私钥">
          <el-input
            v-model="form.privateKey"
            type="textarea"
            placeholder="粘贴 SSH 私钥内容（PEM 格式）"
            :rows="6"
            spellcheck="false"
            autocomplete="off"
          />
          <span v-if="editingId" style="font-size: 11px; color: #8c8c8c;">留空则不修改已有凭据</span>
        </el-form-item>
        <el-form-item label="服务器 Host Key" required>
          <el-input v-model="form.hostKey" type="textarea" :rows="2" placeholder="例如：ssh-ed25519 AAAA..." spellcheck="false" />
          <span style="font-size: 11px; color: #8c8c8c;">从目标机可信来源确认后填写；Launchly 不会自动信任未知主机。NAS 的 Host Key 路径可能不同于 Ubuntu。</span>
        </el-form-item>
      </el-form>
      <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon style="margin-top: 8px;" />
      <template #footer>
        <el-button @click="modalOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchAllDeployTargets,
  fetchProjects,
  createDeployTarget,
  updateDeployTarget,
  deleteDeployTarget,
  verifyDeployTarget,
} from '../api/client'
import { usePermission } from '../composables/usePermission'

const { canWrite } = usePermission()

const targets = ref<any[]>([])
const projects = ref<any[]>([])
const loading = ref(false)
const searchText = ref('')
const modalOpen = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const errorMsg = ref('')

const form = reactive({
  projectId: undefined as string | undefined,
  name: '',
  type: 'SSH',
  host: '',
  port: 22,
  username: 'deploy',
  workRoot: '/var/lib/launchly',
  authMethod: 'KEY',
  privateKey: '',
  hostKey: '',
})

const typeMap: Record<string, string> = {
  BYOS_SSH: 'SSH',
  BYOS_DOCKER_CONTEXT: 'Docker Context',
  BYOS_K8S: 'Kubernetes',
}

const statusMap: Record<string, string> = {
  UNVERIFIED: '未验证',
  VERIFIED: '已验证',
  CONNECTED: '已连接',
  FAILED: '连接失败',
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const filteredTargets = computed(() => {
  if (!searchText.value) return targets.value
  const q = searchText.value.toLowerCase()
  return targets.value.filter(t =>
    (t.projectName || '').toLowerCase().includes(q) ||
    t.name.toLowerCase().includes(q) ||
    t.host.toLowerCase().includes(q)
  )
})

onMounted(async () => {
  await Promise.all([loadTargets(), loadProjects()])
})

async function loadTargets() {
  loading.value = true
  try {
    const res = await fetchAllDeployTargets()
    targets.value = res.data || []
  } catch {
    ElMessage.error('加载部署目标失败')
  }
  loading.value = false
}

async function loadProjects() {
  try {
    const res = await fetchProjects()
    projects.value = res.data || []
  } catch {
    // silent
  }
}

function openCreate() {
  editingId.value = null
  form.projectId = projects.value.length === 1 ? projects.value[0].id : undefined
  form.name = ''
  form.type = 'SSH'
  form.host = ''
  form.port = 22
  form.username = 'deploy'
  form.workRoot = '/var/lib/launchly'
  form.authMethod = 'KEY'
  form.privateKey = ''
  form.hostKey = ''
  errorMsg.value = ''
  modalOpen.value = true
}

function openEdit(record: any) {
  editingId.value = record.id
  form.projectId = record.projectId
  form.name = record.name
  form.type = record.type
  form.host = record.host
  form.port = record.port
  form.username = record.username
  form.workRoot = record.workRoot || '/var/lib/launchly'
  form.authMethod = record.authMethod
  form.privateKey = ''
  form.hostKey = ''
  errorMsg.value = ''
  modalOpen.value = true
}

async function doSave() {
  errorMsg.value = ''
  if (!editingId.value && !form.projectId) {
    errorMsg.value = '请选择所属项目'
    return
  }
  if (!form.name || !form.host || !form.username || !form.hostKey) {
    errorMsg.value = '名称、主机地址、用户名和 Host Key 为必填项'
    return
  }
  if (form.username === 'root') {
    errorMsg.value = '禁止使用 root，请使用最小权限部署用户'
    return
  }
  if (!editingId.value && (!form.privateKey || !String(form.privateKey).trim())) {
    errorMsg.value = '请粘贴 SSH 私钥'
    return
  }

  saving.value = true
  try {
    const data: any = {
      name: form.name,
      type: form.type,
      host: form.host,
      port: form.port,
      username: form.username,
      workRoot: form.workRoot,
      authMethod: form.authMethod,
      hostKey: form.hostKey,
    }
    if (form.privateKey) {
      data.privateKey = form.privateKey
    }

    if (editingId.value) {
      await updateDeployTarget(editingId.value, data)
      ElMessage.success('部署目标已更新')
    } else {
      await createDeployTarget(form.projectId!, data)
      ElMessage.success('部署目标已创建')
    }
    modalOpen.value = false
    await loadTargets()
  } catch (e: any) {
    errorMsg.value = e.response?.data?.message || '保存失败'
  }
  saving.value = false
}

async function doDelete(id: string) {
  try {
    await deleteDeployTarget(id)
    ElMessage.success('已删除')
    await loadTargets()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

async function verify(record: any) {
  ElMessage.info('正在验证连接...')
  try {
    const res = await verifyDeployTarget(record.id)
    const r = res.data
    if (r.success) {
      ElMessage.success(r.message || '连接成功')
    } else {
      ElMessage.error(r.message || '连接失败')
    }
    await loadTargets()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '验证失败')
  }
}
</script>
