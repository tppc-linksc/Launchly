<template>
  <div>
    <h2>部署记录</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">当前工作空间内的全部部署记录（不限于单个项目）。从项目详情触发部署后，可在此查看历史与状态。</p>
    <el-table :data="deployments" v-loading="loading" row-key="id" @row-click="(r: any) => $router.push(`/deployments/${r.id}`)" style="cursor: pointer;">
      <el-table-column prop="branch" label="分支" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ deployStatusMap[row.status] || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="触发人" width="120">
        <template #default="{ row }">{{ row.triggeredByName || row.triggeredBy || '—' }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button type="primary" link @click.stop="$router.push(`/deployments/${row.id}`)">详情</el-button>
          <el-button v-if="canDeploy && row.status === 'FAILED'" type="danger" link @click.stop="handleRedeploy(row)">重新部署</el-button>
          <el-button v-if="canDeploy && row.status === 'SUCCEEDED' && row.commitSha" type="primary" link @click.stop="handleRollback(row)">回滚</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && deployments.length === 0" description="暂无部署记录，从项目详情触发第一次部署">
      <el-button type="primary" @click="$router.push('/projects')">前往项目</el-button>
    </el-empty>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchDeployments, createDeployment, rollbackDeployment } from '../api/client'
import { deployStatusMap, formatTime } from '../utils/display'
import { usePermission } from '../composables/usePermission'

const { canDeploy } = usePermission()

const router = useRouter()

const deployments = ref<any[]>([])
const loading = ref(false)

function statusType(s: string) {
  const map: Record<string, string> = {
    PENDING: 'info', RUNNING: 'warning', SUCCEEDED: 'success',
    FAILED: 'danger', CANCELED: 'info',
  }
  return (map[s] || 'info') as any
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
    ElMessage.success('已触发重新部署')
    router.push(`/deployments/${res.data.id}`)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '重新部署失败')
  }
}

async function handleRollback(record: any) {
  try {
    await ElMessageBox.confirm(
      `确定要回滚到 commit ${record.commitSha?.substring(0, 7)} 的版本吗？`,
      '回滚确认',
      { type: 'warning' },
    )
    const res = await rollbackDeployment(record.id, { reason: '手动回滚' })
    ElMessage.success('回滚部署已触发')
    router.push(`/deployments/${res.data.id}`)
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.message || '回滚失败')
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await fetchDeployments()
    deployments.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
})
</script>
