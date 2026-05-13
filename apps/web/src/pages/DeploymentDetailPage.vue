<template>
  <div v-if="deployment">
    <a-page-header title="部署详情" @back="$router.push('/deployments')" />
    <a-card style="margin-bottom: 16px;">
      <a-descriptions :column="2" size="small">
        <a-descriptions-item label="分支">{{ deployment.branch }}</a-descriptions-item>
        <a-descriptions-item label="Commit">{{ deployment.commitSha || '-' }}</a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="statusColor(deployment.status)">{{ deployStatusMap[deployment.status] || deployment.status }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="部署目标">{{ deployment.deployTarget?.name || '本地' }} <span v-if="deployment.deployTarget" style="color: #8c8c8c;">({{ deployment.deployTarget.host }})</span></a-descriptions-item>
        <a-descriptions-item label="触发人">{{ deployment.triggeredBy }}</a-descriptions-item>
        <a-descriptions-item label="开始时间">{{ deployment.startedAt || '—' }}</a-descriptions-item>
        <a-descriptions-item label="结束时间">{{ deployment.finishedAt || '—' }}</a-descriptions-item>
      </a-descriptions>
      <a-alert v-if="deployment.errorMessage" type="error" :message="deployment.errorMessage" show-icon style="margin-top: 12px;" />
      <div v-if="deployment.status === 'SUCCEEDED'" style="margin-top: 12px;">
        <a-button type="primary" @click="createTestRun">创建测试任务</a-button>
      </div>
    </a-card>

    <a-card title="阶段日志">
      <a-timeline>
        <a-timeline-item v-for="log in logs" :key="log.id" :color="log.status === 'SUCCEEDED' ? 'green' : log.status === 'FAILED' ? 'red' : log.status === 'RUNNING' ? 'blue' : 'gray'">
          <strong>{{ deployStageMap[log.stage] || log.stage }}</strong>
          <a-tag :color="log.status === 'SUCCEEDED' ? 'green' : log.status === 'FAILED' ? 'red' : 'default'" style="margin-left: 8px;">{{ deployStatusMap[log.status] || log.status }}</a-tag>
          <pre v-if="log.log" style="background: #f6f8fa; padding: 8px; margin-top: 8px; font-size: 12px; max-height: 200px; overflow: auto;">{{ log.log }}</pre>
        </a-timeline-item>
      </a-timeline>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { fetchDeployment, fetchDeploymentLogs, createTestRun } from '../api/client'
import { deployStatusMap, deployStageMap } from '../utils/display'

const route = useRoute()
const router = useRouter()
const deployment = ref<any>(null)
const logs = ref<any[]>([])

function statusColor(s: string) {
  const map: Record<string, string> = {
    PENDING: 'default', RUNNING: 'processing', SUCCEEDED: 'success',
    FAILED: 'error', CANCELED: 'warning',
  }
  return map[s] || 'default'
}

async function handleCreateTestRun() {
  try {
    const res = await createTestRun(deployment.value.id, deployment.value.projectId, deployment.value.environmentId)
    message.success('测试任务已创建')
    router.push(`/tests/runs/${res.data.id}`)
  } catch (e: any) {
    message.error(e.response?.data?.message || '创建测试任务失败')
  }
}

onMounted(async () => {
  const id = route.params.id as string
  try {
    const [dRes, lRes] = await Promise.all([fetchDeployment(id), fetchDeploymentLogs(id)])
    deployment.value = dRes.data
    logs.value = lRes.data
  } catch {}
})
</script>
