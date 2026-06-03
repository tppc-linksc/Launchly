<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>发布管理</h2>
        <p style="color: #8c8c8c;">查看发布历史、门禁状态和发布详情。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadReleases">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-button type="primary" @click="showCreate = true" :disabled="!selectedProjectId">新建 Release</el-button>
      </div>
    </div>

    <el-table :data="releases" row-key="id" v-loading="loading" @row-click="(r: any) => $router.push(`/releases/${selectedProjectId}/${r.id}`)" style="cursor: pointer;">
      <el-table-column prop="version" label="版本" />
      <el-table-column prop="environmentId" label="环境" show-overflow-tooltip />
      <el-table-column label="状态">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ releaseStatusMap[row.status] || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="门禁">
        <template #default="{ row }">
          <el-tag :type="row.gateStatus === 'PASSED' ? 'success' : 'danger'">{{ row.gateStatus === 'PASSED' ? '通过' : row.gateStatus === 'FAILED' ? '失败' : row.gateStatus || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="releasedBy" label="发布人" />
      <el-table-column prop="releasedAt" label="发布时间" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button link @click.stop="$router.push(`/releases/${selectedProjectId}/${row.id}`)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && releases.length === 0 && selectedProjectId" description="暂无 Release" />

    <!-- Create Modal -->
    <el-dialog v-model="showCreate" title="新建 Release">
      <el-form label-position="top">
        <el-form-item label="版本号" required>
          <el-input v-model="form.version" placeholder="例如 1.0.0" />
        </el-form-item>
        <el-form-item label="关联部署">
          <el-select v-model="form.deploymentId" placeholder="选择部署" clearable>
            <el-option v-for="d in deployments" :key="d.id" :label="`${d.branch} (${d.createdAt?.slice(0, 10)})`" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布说明">
          <el-input type="textarea" v-model="form.notes" :rows="3" placeholder="发布说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="handleCreate">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchProjects, fetchReleases, fetchDeployments, createRelease } from '../api/client'
import { releaseStatusMap } from '../utils/display'

const route = useRoute()

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const releases = ref<any[]>([])
const deployments = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const form = ref({ version: '', deploymentId: '', notes: '' })

function statusType(s: string) {
  const map: Record<string, string> = { DRAFT: 'info', PENDING_GATES: 'warning', READY: 'success', PUBLISHED: 'primary', FAILED: 'danger' }
  return map[s] || 'info'
}

async function loadReleases() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const [relRes, depRes] = await Promise.all([
      fetchReleases(selectedProjectId.value),
      fetchDeployments({ projectId: selectedProjectId.value }),
    ])
    releases.value = relRes.data
    deployments.value = (depRes.data || []).filter((d: any) => d.status === 'SUCCEEDED')
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
}

async function handleCreate() {
  try {
    await createRelease(selectedProjectId.value, form.value)
    showCreate.value = false
    form.value = { version: '', deploymentId: '', notes: '' }
    loadReleases()
  } catch (e: any) { console.error(e) }
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  const qp = route.query.projectId as string
  if (qp) {
    selectedProjectId.value = qp
    loadReleases()
  }
})
</script>
