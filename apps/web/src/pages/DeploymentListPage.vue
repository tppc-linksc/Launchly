<template>
  <div>
    <h2>部署记录</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">当前工作空间内的全部部署记录（不限于单个项目）。从项目详情触发部署后，可在此查看历史与状态。</p>
    <a-table :columns="columns" :data-source="deployments" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/deployments/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ deployStatusMap[record.status] || record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/deployments/${record.id}`)">详情</a-button>
          <a-button v-if="record.status === 'FAILED'" type="link" danger @click.stop="handleRedeploy(record)">重新部署</a-button>
          <a-button v-if="record.status === 'SUCCEEDED' && record.commitSha" type="link" @click.stop="handleRollback(record)">回滚</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && deployments.length === 0" description="暂无部署记录，从项目详情触发第一次部署">
      <a-button type="primary" @click="$router.push('/projects')">前往项目</a-button>
    </a-empty>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import { fetchDeployments, createDeployment, rollbackDeployment } from '../api/client'
import { deployStatusMap, formatTime } from '../utils/display'

const router = useRouter()

const columns = [
  { title: '分支', dataIndex: 'branch', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '触发人', dataIndex: 'triggeredByName', customRender: ({ text, record }: any) => text || record.triggeredBy || '—' },
  { title: '创建时间', dataIndex: 'createdAt', customRender: ({ text }: any) => formatTime(text) },
  { title: '操作', key: 'action', width: 180 },
]

const deployments = ref<any[]>([])
const loading = ref(false)

function statusColor(s: string) {
  const map: Record<string, string> = {
    PENDING: 'default', RUNNING: 'processing', SUCCEEDED: 'success',
    FAILED: 'error', CANCELED: 'warning',
  }
  return map[s] || 'default'
}

async function handleRedeploy(record: any) {
  try {
    const payload = {
      projectId: record.projectId,
      environmentId: record.environmentId,
      deployTargetId: record.deployTargetId || undefined,
      branch: record.branch,
      commitSha: record.commitSha || undefined,
    }
    const res = await createDeployment(payload)
    message.success('已触发重新部署')
    router.push(`/deployments/${res.data.id}`)
  } catch (e: any) {
    message.error(e.response?.data?.message || '重新部署失败')
  }
}

async function handleRollback(record: any) {
  Modal.confirm({
    title: '回滚确认',
    content: `确定要回滚到 commit ${record.commitSha?.substring(0, 7)} 的版本吗？`,
    onOk: async () => {
      try {
        const res = await rollbackDeployment(record.id, { reason: '手动回滚' })
        message.success('回滚部署已触发')
        router.push(`/deployments/${res.data.id}`)
      } catch (e: any) {
        message.error(e.response?.data?.message || '回滚失败')
      }
    },
  })
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await fetchDeployments()
    deployments.value = res.data
  } catch {}
  loading.value = false
})
</script>
