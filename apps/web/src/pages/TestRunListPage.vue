<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>测试任务</h2>
        <p style="color: #8c8c8c;">查看所有测试任务及其执行状态。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadTestRuns">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
      </div>
    </div>

    <el-table :data="testRuns" row-key="id" v-loading="loading" @row-click="(r: any) => $router.push(`/tests/runs/${r.id}`)" style="cursor: pointer;">
      <el-table-column prop="deploymentId" label="关联部署" show-overflow-tooltip />
      <el-table-column label="状态">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdBy" label="创建人" />
      <el-table-column prop="createdAt" label="创建时间" />
      <el-table-column prop="finishedAt" label="完成时间" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button link @click.stop="$router.push(`/tests/runs/${row.id}`)">执行</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && testRuns.length === 0 && selectedProjectId" description="暂无测试任务" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchProjects, fetchTestRuns } from '../api/client'

const route = useRoute()

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const testRuns = ref<any[]>([])
const loading = ref(false)

function statusType(s: string) {
  const map: Record<string, string> = { PENDING: 'info', RUNNING: 'warning', COMPLETED: 'success' }
  return map[s] || 'info'
}

async function loadTestRuns() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const res = await fetchTestRuns(selectedProjectId.value)
    testRuns.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  const qp = route.query.projectId as string
  if (qp) {
    selectedProjectId.value = qp
    loadTestRuns()
  }
})
</script>
