<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">部署目标管理</h2>
      <a-button type="primary" @click="openCreate">添加部署目标</a-button>
    </div>

    <a-card>
      <a-table :columns="columns" :data-source="targets" :loading="loading" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'type'">
            <a-tag>{{ typeMap[record.type] || record.type }}</a-tag>
          </template>
          <template v-if="column.key === 'authMethod'">
            <a-tag :color="record.authMethod === 'KEY' ? 'blue' : 'orange'">
              {{ record.authMethod === 'KEY' ? '密钥' : '密码' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'status'">
            <a-badge :status="statusBadge(record.status)" :text="statusMap[record.status] || record.status" />
          </template>
          <template v-if="column.key === 'lastVerifiedAt'">
            <span v-if="record.lastVerifiedAt">{{ record.lastVerifiedAt?.slice(0, 19).replace('T', ' ') }}</span>
            <span v-else style="color: #999;">未验证</span>
          </template>
          <template v-if="column.key === 'actions'">
            <a-space>
              <a-button size="small" @click="verify(record)">验证</a-button>
              <a-button size="small" @click="openEdit(record)">编辑</a-button>
              <a-popconfirm title="确定删除此部署目标？" @confirm="doDelete(record.id)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-empty v-if="!loading && targets.length === 0" description="暂无部署目标，请添加" />
    </a-card>

    <!-- Create / Edit Modal -->
    <a-modal v-model:open="modalOpen" :title="editingId ? '编辑部署目标' : '添加部署目标'"
             @ok="doSave" :confirm-loading="saving" ok-text="保存" cancel-text="取消">
      <a-form layout="vertical" :model="form">
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="生产服务器、测试节点等" />
        </a-form-item>
        <a-form-item label="类型" required>
          <a-select v-model:value="form.type">
            <a-select-option value="BYOS_SSH">BYOS SSH (推荐)</a-select-option>
            <a-select-option value="BYOS_DOCKER_CONTEXT">BYOS Docker Context</a-select-option>
            <a-select-option value="BYOS_K8S">BYOS Kubernetes</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="主机地址" required>
          <a-input v-model:value="form.host" placeholder="192.168.1.100 或 example.com" />
        </a-form-item>
        <a-form-item label="SSH 端口">
          <a-input-number v-model:value="form.port" :min="1" :max="65535" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="用户名" required>
          <a-input v-model:value="form.username" placeholder="root" />
        </a-form-item>
        <a-form-item label="认证方式" required>
          <a-radio-group v-model:value="form.authMethod">
            <a-radio value="KEY">SSH 密钥</a-radio>
            <a-radio value="PASSWORD">密码</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item :label="form.authMethod === 'KEY' ? 'SSH 私钥' : '密码'">
          <a-textarea v-model:value="form.privateKey" :placeholder="form.authMethod === 'KEY' ? '粘贴 SSH 私钥内容（PEM 格式）' : '输入 SSH 密码'"
                      :rows="form.authMethod === 'KEY' ? 6 : 2" />
          <span v-if="editingId" style="font-size: 11px; color: #8c8c8c;">留空则不修改已有凭据</span>
        </a-form-item>
      </a-form>
      <a-alert v-if="errorMsg" :message="errorMsg" type="error" show-icon style="margin-top: 8px;" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  fetchDeployTargets,
  createDeployTarget,
  updateDeployTarget,
  deleteDeployTarget,
  verifyDeployTarget,
} from '../api/client'

const route = useRoute()
const projectId = route.params.id as string

const targets = ref<any[]>([])
const loading = ref(false)
const modalOpen = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const errorMsg = ref('')

const form = reactive({
  name: '',
  type: 'BYOS_SSH',
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'KEY',
  privateKey: '',
})

const typeMap: Record<string, string> = {
  BYOS_SSH: 'SSH',
  BYOS_DOCKER_CONTEXT: 'Docker Context',
  BYOS_K8S: 'Kubernetes',
}

const statusMap: Record<string, string> = {
  UNVERIFIED: '未验证',
  CONNECTED: '已连接',
  FAILED: '连接失败',
}

function statusBadge(status: string): 'success' | 'processing' | 'warning' | 'error' | 'default' {
  if (status === 'CONNECTED') return 'success'
  if (status === 'FAILED') return 'error'
  return 'warning'
}

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '主机', dataIndex: 'host', key: 'host' },
  { title: '端口', dataIndex: 'port', key: 'port' },
  { title: '用户', dataIndex: 'username', key: 'username' },
  { title: '认证', dataIndex: 'authMethod', key: 'authMethod' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '最后验证', dataIndex: 'lastVerifiedAt', key: 'lastVerifiedAt' },
  { title: '操作', key: 'actions', width: 200 },
]

onMounted(() => { loadTargets() })

async function loadTargets() {
  loading.value = true
  try {
    const res = await fetchDeployTargets(projectId)
    targets.value = res.data || []
  } catch {
    message.error('加载部署目标失败')
  }
  loading.value = false
}

function openCreate() {
  editingId.value = null
  form.name = ''
  form.type = 'BYOS_SSH'
  form.host = ''
  form.port = 22
  form.username = 'root'
  form.authMethod = 'KEY'
  form.privateKey = ''
  errorMsg.value = ''
  modalOpen.value = true
}

function openEdit(record: any) {
  editingId.value = record.id
  form.name = record.name
  form.type = record.type
  form.host = record.host
  form.port = record.port
  form.username = record.username
  form.authMethod = record.authMethod
  form.privateKey = ''
  errorMsg.value = ''
  modalOpen.value = true
}

async function doSave() {
  errorMsg.value = ''
  if (!form.name || !form.host || !form.username) {
    errorMsg.value = '名称、主机地址、用户名为必填项'
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
      authMethod: form.authMethod,
    }
    if (form.privateKey) {
      data.privateKey = form.privateKey
    }

    if (editingId.value) {
      await updateDeployTarget(editingId.value, data)
      message.success('部署目标已更新')
    } else {
      await createDeployTarget(projectId, data)
      message.success('部署目标已创建')
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
    message.success('已删除')
    await loadTargets()
  } catch (e: any) {
    message.error(e.response?.data?.message || '删除失败')
  }
}

async function verify(record: any) {
  message.loading({ content: '正在验证连接...', key: 'verify' })
  try {
    const res = await verifyDeployTarget(record.id)
    const r = res.data
    if (r.status === 'CONNECTED') {
      message.success({ content: `连接成功 | Docker: ${r.dockerVersion || '未知'}`, key: 'verify' })
    } else {
      message.error({ content: `连接失败: ${r.error || '未知错误'}`, key: 'verify' })
    }
    await loadTargets()
  } catch (e: any) {
    message.error({ content: e.response?.data?.message || '验证失败', key: 'verify' })
  }
}
</script>
