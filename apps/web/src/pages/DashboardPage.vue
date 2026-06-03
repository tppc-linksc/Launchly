<template>
  <div>
    <h2 class="page-title">当前工作空间</h2>
    <p class="page-lead">正在发生什么：进行中的构建/部署、最近结果与下一步。</p>

    <div class="grid-2">
      <!-- Left: running / recent deployments -->
      <el-card class="card-surface">
        <template #title><span class="card-label">运行中 / 最近</span></template>
        <div v-loading="loading">
          <div v-if="deployments.length === 0" class="empty-soft">
            <p>暂无部署记录</p>
            <el-button type="primary" size="small" @click="$router.push('/projects')">去创建项目</el-button>
          </div>
          <div v-for="d in deployments" :key="d.id" class="run-item" @click="$router.push(`/deployments/${d.id}`)">
            <div>
              <div class="run-title">{{ projectNameMap[d.projectId] || '未知项目' }} → {{ envName(d.environmentId) }}</div>
              <div class="run-meta">
                分支 {{ d.branch || '—' }}
                <span v-if="d.triggeredByName || d.triggeredBy"> · 触发人 {{ d.triggeredByName || d.triggeredBy }}</span>
                <span v-if="d.createdAt"> · {{ formatTime(d.createdAt) }}</span>
              </div>
              <div class="pipeline" v-if="stageLogs[d.id]">
                <span
                  v-for="s in stageLogs[d.id]"
                  :key="s.stage"
                  :class="['pipe-step', pipeClass(s.status)]"
                >{{ deployStageMap[s.stage] || s.stage }}</span>
              </div>
            </div>
            <span :class="['status-badge', statusBadgeClass(d.status)]">{{ deployStatusMap[d.status] || d.status }}</span>
          </div>
        </div>
      </el-card>

      <!-- Right: next steps -->
      <aside class="card-surface side-card">
        <h3 class="card-label">下一步</h3>
        <ul class="side-list">
          <li>
            <span>处理失败部署</span>
            <span :style="{ color: '#dc2626', fontWeight: 600 }">{{ failedCount }}</span>
          </li>
          <li>
            <span>进行中部署</span>
            <span :style="{ color: '#0d9488', fontWeight: 600 }">{{ runningCount }}</span>
          </li>
          <li>
            <span>项目总数</span>
            <span>{{ projectCount }}</span>
          </li>
        </ul>
        <p class="side-hint">点击「部署与运行」看完整时间线；配置型页面从项目卡进入即可。</p>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchDeployments, fetchProjects, fetchDeploymentLogs, fetchEnvironments } from '../api/client'
import { deployStatusMap, deployStageMap, formatTime } from '../utils/display'

const deployments = ref<any[]>([])
const projects = ref<any[]>([])
const envs = ref<any[]>([])
const stageLogs = ref<Record<string, any[]>>({})
const loading = ref(false)

const projectNameMap = computed(() => {
  const map: Record<string, string> = {}
  projects.value.forEach((p: any) => { map[p.id] = p.name })
  return map
})

const projectCount = computed(() => projects.value.length)
const failedCount = computed(() => deployments.value.filter(d => d.status === 'FAILED').length)
const runningCount = computed(() => deployments.value.filter(d => d.status === 'RUNNING' || d.status === 'PENDING').length)

function envName(id: string) {
  if (!id) return '—'
  const env = envs.value.find((e: any) => e.id === id)
  return env?.name || '环境'
}

function statusBadgeClass(status: string) {
  if (status === 'RUNNING' || status === 'PENDING') return 'status-running'
  if (status === 'SUCCEEDED') return 'status-ok'
  if (status === 'FAILED') return 'status-fail'
  return 'status-default'
}

function pipeClass(status: string) {
  if (status === 'SUCCEEDED' || status === 'SKIPPED') return 'done'
  if (status === 'RUNNING') return 'on'
  return ''
}

onMounted(async () => {
  loading.value = true
  try {
    const [dRes, pRes] = await Promise.all([
      fetchDeployments().catch(() => ({ data: [] })),
      fetchProjects().catch(() => ({ data: [] })),
    ])
    deployments.value = (dRes.data || []).slice(0, 10)
    projects.value = pRes.data || []

    // Fetch environments for all projects to display env names
    const projectIds = [...new Set(deployments.value.map(d => d.projectId).filter(Boolean))]
    if (projectIds.length > 0) {
      const envResults = await Promise.all(
        projectIds.map(pid => fetchEnvironments(pid).catch(() => ({ data: [] })))
      )
      envs.value = envResults.flatMap(r => r.data || [])
    }

    // Fetch stage logs for each deployment (limit to first 5 for performance)
    const toFetch = deployments.value.slice(0, 5)
    const logResults = await Promise.all(
      toFetch.map(d => fetchDeploymentLogs(d.id).catch(() => ({ data: [] })))
    )
    toFetch.forEach((d, i) => {
      stageLogs.value[d.id] = logResults[i].data || []
    })
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
})
</script>

<style scoped>
.page-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #111827;
}
.page-lead {
  margin: 0 0 24px;
  color: #6b7280;
  font-size: 14px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
  align-items: start;
}
@media (max-width: 900px) {
  .grid-2 { grid-template-columns: 1fr; }
}

.card-surface {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}
.side-card {
  padding: 20px;
}
.card-label {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
}

.run-item {
  padding: 16px 0;
  border-bottom: 1px solid #e5e7eb;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: start;
  cursor: pointer;
  transition: background 0.1s;
}
.run-item:hover { background: #f9fafb; margin: 0 -20px; padding-left: 20px; padding-right: 20px; }
.run-item:last-child { border-bottom: none; padding-bottom: 0; }
.run-item:first-child { padding-top: 0; }
.run-title { font-weight: 600; margin-bottom: 4px; color: #111827; }
.run-meta { font-size: 13px; color: #6b7280; }

.status-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.status-running { background: #dbeafe; color: #1d4ed8; }
.status-ok { background: #d1fae5; color: #047857; }
.status-fail { background: #fee2e2; color: #b91c1c; }
.status-default { background: #f3f4f6; color: #6b7280; }

.pipeline {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.pipe-step {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: #f3f4f6;
  color: #6b7280;
}
.pipe-step.done { background: #d1fae5; color: #065f46; }
.pipe-step.on { background: #cffafe; color: #0e7490; font-weight: 600; }

.side-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.side-list li {
  padding: 12px 0;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.side-list li:last-child { border-bottom: none; }

.side-hint {
  margin: 16px 0 0;
  font-size: 13px;
  color: #6b7280;
}

.empty-soft {
  text-align: center;
  padding: 48px 24px;
  color: #6b7280;
  font-size: 14px;
}
.empty-soft p { margin-bottom: 16px; }
</style>
