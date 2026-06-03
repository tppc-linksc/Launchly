<template>
  <div v-if="deployment">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
      <el-button link @click="$router.push('/deployments')">&larr; 返回</el-button>
      <h2 style="margin: 0;">部署详情</h2>
    </div>
    <el-card style="margin-bottom: 16px;">
      <el-descriptions :column="2" size="small">
        <el-descriptions-item label="分支">{{ deployment.branch }}</el-descriptions-item>
        <el-descriptions-item label="Commit">{{ commitShort(deployment.commitSha) }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusType(deployment.status)">{{ deployStatusMap[deployment.status] || deployment.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="环境">{{ deployment.environmentName || deployment.environmentId || '—' }}</el-descriptions-item>
        <el-descriptions-item label="部署目标">{{ deployment.deployTarget?.name || '本地' }} <span v-if="deployment.deployTarget && deployment.deployTarget.host" style="color: #8c8c8c;">({{ deployment.deployTarget.host }})</span></el-descriptions-item>
        <el-descriptions-item label="触发人">{{ deployment.triggeredByName || deployment.triggeredBy || '—' }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ formatTime(deployment.startedAt) }}</el-descriptions-item>
        <el-descriptions-item label="结束时间">{{ formatTime(deployment.finishedAt) }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(deployment.createdAt) }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="deployment.accessUrl && deployment.status === 'SUCCEEDED'" type="success" show-icon style="margin-top: 12px;">
        <template #title>
          <span>部署成功！访问地址：<a :href="deployment.accessUrl" target="_blank" style="font-weight: 600;">{{ deployment.accessUrl }}</a></span>
        </template>
      </el-alert>
      <el-alert v-if="deployment.errorMessage" type="error" :title="deployment.errorMessage" show-icon style="margin-top: 12px;" />
      <div style="margin-top: 12px;">
        <el-button v-if="canDeploy && deployment.status === 'FAILED'" type="danger" style="margin-right: 8px;" :loading="redeploying" @click="handleRedeploy">
          重新部署
        </el-button>
        <el-button v-if="canWrite && deployment.status === 'SUCCEEDED'" type="primary" style="margin-right: 8px;" @click="handleCreateTestRun">
          创建测试任务
        </el-button>
        <el-button v-if="canDeploy && deployment.status === 'SUCCEEDED' && deployment.commitSha" style="margin-right: 8px;" :loading="rollingBack" @click="handleRollback">
          回滚到此版本
        </el-button>
      </div>
      <div v-if="deployment.status === 'SUCCEEDED'" style="margin-top: 12px; display: flex; gap: 12px;">
        <el-button size="small" @click="$router.push(`/tests/runs?projectId=${deployment.projectId}`)">查看测试记录</el-button>
        <el-button size="small" @click="$router.push(`/issues?projectId=${deployment.projectId}`)">查看 Issue</el-button>
        <el-button size="small" @click="$router.push(`/releases?projectId=${deployment.projectId}`)">查看发布</el-button>
        <el-button size="small" @click="$router.push(`/projects/${deployment.projectId}`)">返回项目</el-button>
      </div>
    </el-card>

    <el-card header="阶段日志">
      <el-timeline>
        <el-timeline-item v-for="log in logs" :key="log.id" :color="dotColor(log.status)">
          <strong>{{ deployStageMap[log.stage] || log.stage }}</strong>
          <el-tag :type="tagType(log.status)" style="margin-left: 8px;">{{ deployStatusMap[log.status] || log.status }}</el-tag>
          <pre v-if="log.log" style="background: #f6f8fa; padding: 8px; margin-top: 8px; font-size: 12px; max-height: 200px; overflow: auto;">{{ log.log }}</pre>
        </el-timeline-item>
      </el-timeline>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchDeployment, fetchDeploymentLogs, createTestRun, createDeployment, rollbackDeployment } from '../api/client'
import { deployStatusMap, deployStageMap, formatTime } from '../utils/display'
import { usePermission } from '../composables/usePermission'

const { canDeploy, canWrite } = usePermission()

const route = useRoute()
const router = useRouter()
const deployment = ref<any>(null)
const logs = ref<any[]>([])
const redeploying = ref(false)
const rollingBack = ref(false)
let abortController: AbortController | null = null

function commitShort(sha: string) {
  return sha ? sha.substring(0, 7) : '-'
}

function statusType(s: string) {
  const map: Record<string, string> = {
    PENDING: 'info', RUNNING: 'primary', SUCCEEDED: 'success',
    FAILED: 'danger', CANCELED: 'warning',
  }
  return map[s] || 'info'
}

function dotColor(s: string) {
  const map: Record<string, string> = {
    RUNNING: 'blue', SUCCEEDED: 'green', FAILED: 'red',
    SKIPPED: 'gray', PENDING: 'gray',
  }
  return map[s] || 'gray'
}

function tagType(s: string) {
  const map: Record<string, string> = {
    SUCCEEDED: 'success', FAILED: 'danger', RUNNING: 'primary',
    SKIPPED: 'info', PENDING: 'info',
  }
  return map[s] || 'info'
}

async function connectSSE(id: string) {
  const token = localStorage.getItem('accessToken')
  abortController = new AbortController()

  try {
    const response = await fetch(`/api/deployments/${id}/logs/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: abortController.signal,
    })
    if (!response.ok || !response.body) return

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (!data) continue
          try {
            if (currentEvent === 'logs') {
              logs.value = JSON.parse(data)
            } else if (currentEvent === 'status') {
              const statusData = JSON.parse(data)
              if (deployment.value) {
                deployment.value.status = statusData.status
                deployment.value.errorMessage = statusData.errorMessage || ''
              }
              if (statusData.status === 'SUCCEEDED' || statusData.status === 'FAILED') {
                fetchDeployment(id).then(res => { deployment.value = res.data }).catch(() => {})
              }
            }
          } catch { /* skip unparseable SSE data */ }
        }
      }
    }
  } catch { /* SSE connection closed */ }
}

async function handleCreateTestRun() {
  try {
    const res = await createTestRun(deployment.value.id, deployment.value.projectId, deployment.value.environmentId)
    ElMessage.success('测试任务已创建')
    router.push(`/tests/runs/${res.data.id}`)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '创建测试任务失败')
  }
}

async function handleRedeploy() {
  redeploying.value = true
  try {
    const payload = {
      projectId: deployment.value.projectId,
      environmentId: deployment.value.environmentId,
      deployTargetId: deployment.value.deployTargetId || undefined,
      branch: deployment.value.branch,
      commitSha: deployment.value.commitSha || undefined,
    }
    const res = await createDeployment(payload)
    ElMessage.success('已触发重新部署')
    router.push(`/deployments/${res.data.id}`)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '重新部署失败')
    redeploying.value = false
  }
}

async function handleRollback() {
  try {
    await ElMessageBox.confirm(
      `确定要回滚到 commit ${commitShort(deployment.value.commitSha)} 的版本吗？将创建新的部署。`,
      '回滚确认',
      { type: 'warning' },
    )
    rollingBack.value = true
    try {
      const res = await rollbackDeployment(deployment.value.id, { reason: '手动回滚' })
      ElMessage.success('回滚部署已触发')
      router.push(`/deployments/${res.data.id}`)
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message || '回滚失败')
      rollingBack.value = false
    }
  } catch {
    // user cancelled
  }
}

onMounted(async () => {
  const id = route.params.id as string
  try {
    const [dRes, lRes] = await Promise.all([fetchDeployment(id), fetchDeploymentLogs(id)])
    deployment.value = dRes.data
    logs.value = lRes.data
  } catch {
    return
  }
  // Connect SSE for real-time updates if deployment is still running
  if (deployment.value.status === 'PENDING' || deployment.value.status === 'RUNNING') {
    connectSSE(id)
  }
})

onUnmounted(() => {
  abortController?.abort()
})
</script>

<style scoped>
/* Timeline dot pulse animation for RUNNING status */
:deep(.el-timeline-item__tail) {
  border-left: 2px solid #e8e8e8;
}
:deep(.el-timeline-item__node--primary) {
  animation: dotPulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.4);
}
@keyframes dotPulse {
  0% { box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.4); }
  70% { box-shadow: 0 0 0 8px rgba(64, 158, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(64, 158, 255, 0); }
}
</style>
