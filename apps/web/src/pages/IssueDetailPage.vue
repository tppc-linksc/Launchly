<template>
  <div>
    <a-page-header :title="issue?.title" @back="() => $router.back()">
      <template #tags>
        <a-tag :color="priorityColor(issue?.priority)">{{ priorityMap[issue?.priority] || issue?.priority }}</a-tag>
        <a-tag :color="statusColor(issue?.status)">{{ issueStatusMap[issue?.status] || issue?.status }}</a-tag>
      </template>
    </a-page-header>

    <a-descriptions bordered size="small" :column="2" style="margin-bottom: 24px;">
      <a-descriptions-item label="项目">{{ issue?.projectId }}</a-descriptions-item>
      <a-descriptions-item label="环境">{{ issue?.environmentId || '-' }}</a-descriptions-item>
      <a-descriptions-item label="关联部署">{{ issue?.deploymentId || '-' }}</a-descriptions-item>
      <a-descriptions-item label="关联测试用例">{{ issue?.testRunCaseId || '-' }}</a-descriptions-item>
      <a-descriptions-item label="负责人">{{ issue?.assigneeId || '未指派' }}</a-descriptions-item>
      <a-descriptions-item label="创建时间">{{ issue?.createdAt }}</a-descriptions-item>
      <a-descriptions-item label="截止时间">{{ issue?.dueDate || '-' }}</a-descriptions-item>
      <a-descriptions-item label="修复 Commit">{{ issue?.fixedCommitSha || '-' }}</a-descriptions-item>
    </a-descriptions>

    <div v-if="issue?.description" style="margin-bottom: 24px; padding: 12px; background: #fafafa; border-radius: 4px;">
      <h4>描述</h4>
      <p style="white-space: pre-wrap;">{{ issue?.description }}</p>
    </div>

    <!-- State Transition Actions -->
    <div style="margin-bottom: 24px;">
      <h4 style="margin-bottom: 12px;">状态操作</h4>
      <a-space wrap>
        <a-button v-if="canTransition('ASSIGNED')" type="primary" @click="showAssignModal = true">指派</a-button>
        <a-button v-if="canTransition('FIXING')" @click="doTransition('FIXING')">开始修复</a-button>
        <a-button v-if="canTransition('FIXED')" @click="showFixedModal = true">标记已修复</a-button>
        <a-button v-if="canTransition('CLOSED')" type="primary" style="background: #52c41a; border-color: #52c41a;" @click="doTransition('CLOSED')">关闭</a-button>
        <a-button v-if="canTransition('REOPENED')" danger @click="doTransition('REOPENED')">重新打开</a-button>
      </a-space>
    </div>

    <!-- Assign Modal -->
    <a-modal v-model:open="showAssignModal" title="指派负责人" @ok="handleAssign">
      <a-form-item label="负责人 ID">
        <a-input v-model:value="assignForm.assigneeId" placeholder="输入成员 ID" />
      </a-form-item>
    </a-modal>

    <!-- Fixed Modal -->
    <a-modal v-model:open="showFixedModal" title="标记已修复" @ok="handleFixed">
      <a-form-item label="Commit SHA" required>
        <a-input v-model:value="fixedForm.commitSha" placeholder="输入修复 commit SHA" />
      </a-form-item>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchIssue, updateIssue, transitionIssue } from '../api/client'
import { issueStatusMap, priorityMap } from '../utils/display'

const route = useRoute()
const issue = ref<any>(null)
const showAssignModal = ref(false)
const showFixedModal = ref(false)
const assignForm = ref({ assigneeId: '' })
const fixedForm = ref({ commitSha: '' })
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ASSIGNED', 'CLOSED'],
  ASSIGNED: ['FIXING', 'CLOSED'],
  FIXING: ['FIXED', 'ASSIGNED'],
  FIXED: ['CLOSED', 'REOPENED'],
  REOPENED: ['ASSIGNED', 'CLOSED'],
  CLOSED: [],
}

function canTransition(target: string) {
  if (!issue.value) return false
  return (TRANSITIONS[issue.value.status] || []).includes(target)
}

function priorityColor(p: string) {
  const map: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' }
  return map[p] || 'default'
}

function statusColor(s: string) {
  const map: Record<string, string> = {
    OPEN: 'default', ASSIGNED: 'blue', FIXING: 'processing',
    FIXED: 'success', REOPENED: 'warning', CLOSED: 'default'
  }
  return map[s] || 'default'
}

async function doTransition(target: string, commitSha?: string) {
  try {
    const body: any = { targetStatus: target }
    if (commitSha) body.fixedCommitSha = commitSha
    const res = await transitionIssue(issue.value.projectId, issue.value.id, body)
    issue.value = res.data
  } catch (e: any) {
    console.error('Transition failed', e)
  }
}

async function handleAssign() {
  try {
    const res = await updateIssue(issue.value.projectId, issue.value.id, {
      assigneeId: assignForm.value.assigneeId
    })
    issue.value = res.data
    showAssignModal.value = false
    assignForm.value.assigneeId = ''
  } catch (e) { console.error(e) }
}

async function handleFixed() {
  await doTransition('FIXED', fixedForm.value.commitSha)
  showFixedModal.value = false
  fixedForm.value.commitSha = ''
}

onMounted(async () => {
  try {
    const projectId = route.params.projectId as string
    const res = await fetchIssue(projectId, route.params.id as string)
    issue.value = res.data
  } catch (e) { message.error('操作失败，请稍后重试') }
})
</script>
