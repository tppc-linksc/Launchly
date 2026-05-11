<template>
  <div>
    <a-page-header :title="'Release ' + release?.version" @back="() => $router.back()">
      <template #tags>
        <a-tag :color="statusColor(release?.status)">{{ releaseStatusMap[release?.status] || release?.status }}</a-tag>
        <a-tag :color="release?.gateStatus === 'PASSED' ? 'green' : 'red'">{{ release?.gateStatus === 'PASSED' ? '通过' : release?.gateStatus === 'FAILED' ? '失败' : '未知' }}</a-tag>
      </template>
      <template #extra>
        <a-button v-if="release?.status === 'READY'" type="primary" @click="handlePublish" :loading="publishing">发布</a-button>
      </template>
    </a-page-header>

    <a-descriptions bordered size="small" :column="2" style="margin-bottom: 24px;">
      <a-descriptions-item label="版本">{{ release?.version }}</a-descriptions-item>
      <a-descriptions-item label="环境">{{ release?.environmentId }}</a-descriptions-item>
      <a-descriptions-item label="关联部署">{{ release?.deploymentId || '-' }}</a-descriptions-item>
      <a-descriptions-item label="发布人">{{ release?.releasedBy || '-' }}</a-descriptions-item>
      <a-descriptions-item label="发布时间">{{ release?.releasedAt || '-' }}</a-descriptions-item>
      <a-descriptions-item label="创建时间">{{ release?.createdAt }}</a-descriptions-item>
    </a-descriptions>

    <div v-if="release?.notes" style="margin-bottom: 24px; padding: 12px; background: #fafafa;">
      <h4>发布说明</h4>
      <p>{{ release.notes }}</p>
    </div>

    <!-- Gate Check Results -->
    <h4 style="margin-bottom: 12px;">门禁检查</h4>
    <a-table :columns="gateColumns" :data-source="gateResults" row-key="gateName" size="small" style="margin-bottom: 24px;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'gateName'">
          {{ gateNameMap[record.gateName] || record.gateName }}
        </template>
        <template v-if="column.key === 'passed'">
          <a-tag :color="record.passed ? 'green' : 'red'">{{ record.passed ? '通过' : '失败' }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button v-if="!record.passed && release?.status !== 'PUBLISHED'" type="link" size="small" @click="handleExempt(record)">豁免</a-button>
        </template>
      </template>
    </a-table>

    <!-- Exemption Modal -->
    <a-modal v-model:open="showExemptModal" title="门禁豁免" @ok="handleExemptConfirm">
      <a-form-item label="门禁项">
        <a-input :value="gateNameMap[exemptGateName] || exemptGateName" disabled />
      </a-form-item>
      <a-form-item label="豁免原因" required>
        <a-textarea v-model:value="exemptReason" :rows="3" placeholder="请填写豁免原因" />
      </a-form-item>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchProjects, fetchRelease, fetchReleaseGates, publishRelease, exemptGate } from '../api/client'
import { releaseStatusMap, gateNameMap } from '../utils/display'

const route = useRoute()
const release = ref<any>(null)
const gateResults = ref<any[]>([])
const publishing = ref(false)
const showExemptModal = ref(false)
const exemptGateName = ref('')
const exemptReason = ref('')
const projects = ref<any[]>([])

const gateColumns = [
  { title: '检查项', dataIndex: 'gateName', key: 'gateName' },
  { title: '结果', dataIndex: 'passed', key: 'passed' },
  { title: '说明', dataIndex: 'message' },
  { title: '操作', key: 'action', width: 80 },
]

function statusColor(s: string) {
  const map: Record<string, string> = { DRAFT: 'default', PENDING_GATES: 'processing', READY: 'success', PUBLISHED: 'blue', FAILED: 'red' }
  return map[s] || 'default'
}

async function handlePublish() {
  publishing.value = true
  try {
    const pid = projects.value.length > 0 ? projects.value[0].id : ''
    const res = await publishRelease(pid, route.params.id as string)
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
    const pid = projects.value.length > 0 ? projects.value[0].id : ''
    await exemptGate(pid, route.params.id as string, exemptGateName.value, { reason: exemptReason.value })
    showExemptModal.value = false
    const gatesRes = await fetchReleaseGates(pid, route.params.id as string)
    gateResults.value = gatesRes.data.results || []
  } catch (e) { console.error(e) }
}

onMounted(async () => {
  try {
    const [projRes] = await Promise.all([fetchProjects()])
    projects.value = projRes.data
    const pid = projects.value.length > 0 ? projects.value[0].id : ''
    if (pid) {
      const [relRes, gatesRes] = await Promise.all([
        fetchRelease(pid, route.params.id as string),
        fetchReleaseGates(pid, route.params.id as string),
      ])
      release.value = relRes.data
      gateResults.value = gatesRes.data.results || []
    }
  } catch {}
})
</script>
