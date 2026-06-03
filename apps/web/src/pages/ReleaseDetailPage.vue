<template>
  <div>
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap;">
      <el-button link @click="() => $router.back()">&larr; 返回</el-button>
      <h2 style="margin: 0;">Release {{ release?.version }}</h2>
      <el-tag :type="statusType(release?.status)">{{ releaseStatusMap[release?.status] || release?.status }}</el-tag>
      <el-tag :type="release?.gateStatus === 'PASSED' ? 'success' : 'danger'">{{ release?.gateStatus === 'PASSED' ? '通过' : release?.gateStatus === 'FAILED' ? '失败' : '未知' }}</el-tag>
      <div style="flex: 1;" />
      <el-button v-if="release?.status === 'READY'" type="primary" @click="handlePublish" :loading="publishing">发布</el-button>
    </div>

    <el-descriptions border size="small" :column="2" style="margin-bottom: 24px;">
      <el-descriptions-item label="版本">{{ release?.version }}</el-descriptions-item>
      <el-descriptions-item label="环境">{{ release?.environmentId }}</el-descriptions-item>
      <el-descriptions-item label="关联部署">{{ release?.deploymentId || '-' }}</el-descriptions-item>
      <el-descriptions-item label="发布人">{{ release?.releasedBy || '-' }}</el-descriptions-item>
      <el-descriptions-item label="发布时间">{{ release?.releasedAt || '-' }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ release?.createdAt }}</el-descriptions-item>
    </el-descriptions>

    <div v-if="release?.notes" style="margin-bottom: 24px; padding: 12px; background: #fafafa;">
      <h4>发布说明</h4>
      <p>{{ release.notes }}</p>
    </div>

    <!-- Gate Check Results -->
    <h4 style="margin-bottom: 12px;">门禁检查</h4>
    <el-table :data="gateResults" row-key="gateName" size="small" style="margin-bottom: 24px;">
      <el-table-column label="检查项">
        <template #default="{ row }">
          {{ gateNameMap[row.gateName] || row.gateName }}
        </template>
      </el-table-column>
      <el-table-column label="结果">
        <template #default="{ row }">
          <el-tag :type="row.passed ? 'success' : 'danger'">{{ row.passed ? '通过' : '失败' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="说明" />
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button v-if="!row.passed && release?.status !== 'PUBLISHED'" link size="small" @click="handleExempt(row)">豁免</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- Exemption Modal -->
    <el-dialog v-model="showExemptModal" title="门禁豁免">
      <el-form-item label="门禁项">
        <el-input :value="gateNameMap[exemptGateName] || exemptGateName" disabled />
      </el-form-item>
      <el-form-item label="豁免原因" required>
        <el-input type="textarea" v-model="exemptReason" :rows="3" placeholder="请填写豁免原因" />
      </el-form-item>
      <template #footer>
        <el-button @click="showExemptModal = false">取消</el-button>
        <el-button type="primary" @click="handleExemptConfirm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchRelease, fetchReleaseGates, publishRelease, exemptGate } from '../api/client'
import { releaseStatusMap, gateNameMap } from '../utils/display'

const route = useRoute()
const release = ref<any>(null)
const gateResults = ref<any[]>([])
const publishing = ref(false)
const showExemptModal = ref(false)
const exemptGateName = ref('')
const exemptReason = ref('')

function statusType(s: string) {
  const map: Record<string, string> = { DRAFT: 'info', PENDING_GATES: 'warning', READY: 'success', PUBLISHED: 'primary', FAILED: 'danger' }
  return map[s] || 'info'
}

async function handlePublish() {
  publishing.value = true
  try {
    const projectId = route.params.projectId as string
    const res = await publishRelease(projectId, route.params.id as string)
    release.value = res.data
  } catch (e: any) { console.error(e) }
  publishing.value = false
}

function handleExempt(record: any) {
  exemptGateName.value = record.gateName
  exemptReason.value = ''
  showExemptModal.value = true
}

async function handleExemptConfirm() {
  try {
    const projectId = route.params.projectId as string
    await exemptGate(projectId, route.params.id as string, exemptGateName.value, { reason: exemptReason.value })
    showExemptModal.value = false
    const gatesRes = await fetchReleaseGates(projectId, route.params.id as string)
    gateResults.value = gatesRes.data.results || []
  } catch (e) { console.error(e) }
}

onMounted(async () => {
  try {
    const projectId = route.params.projectId as string
    const [relRes, gatesRes] = await Promise.all([
      fetchRelease(projectId, route.params.id as string),
      fetchReleaseGates(projectId, route.params.id as string),
    ])
    release.value = relRes.data
    gateResults.value = gatesRes.data.results || []
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
})
</script>
