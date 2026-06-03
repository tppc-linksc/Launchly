<template>
  <div>
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
      <el-button link @click="() => $router.back()">&larr; 返回</el-button>
      <h2 style="margin: 0;">{{ issue?.title }}</h2>
      <el-tag :type="priorityType(issue?.priority)">{{ priorityMap[issue?.priority] || issue?.priority }}</el-tag>
      <el-tag :type="statusType(issue?.status)">{{ issueStatusMap[issue?.status] || issue?.status }}</el-tag>
    </div>

    <el-descriptions border size="small" :column="2" style="margin-bottom: 24px;">
      <el-descriptions-item label="项目">{{ issue?.projectId }}</el-descriptions-item>
      <el-descriptions-item label="环境">{{ issue?.environmentId || '-' }}</el-descriptions-item>
      <el-descriptions-item label="关联部署">{{ issue?.deploymentId || '-' }}</el-descriptions-item>
      <el-descriptions-item label="关联测试用例">{{ issue?.testRunCaseId || '-' }}</el-descriptions-item>
      <el-descriptions-item label="负责人">{{ issue?.assigneeId || '未指派' }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ issue?.createdAt }}</el-descriptions-item>
      <el-descriptions-item label="截止时间">{{ issue?.dueDate || '-' }}</el-descriptions-item>
      <el-descriptions-item label="修复 Commit">{{ issue?.fixedCommitSha || '-' }}</el-descriptions-item>
    </el-descriptions>

    <div v-if="issue?.description" style="margin-bottom: 24px; padding: 12px; background: #fafafa; border-radius: 4px;">
      <h4>描述</h4>
      <p style="white-space: pre-wrap;">{{ issue?.description }}</p>
    </div>

    <!-- State Transition Actions -->
    <div style="margin-bottom: 24px;">
      <h4 style="margin-bottom: 12px;">状态操作</h4>
      <el-space wrap>
        <el-button v-if="canTransition('ASSIGNED')" type="primary" @click="showAssignModal = true">指派</el-button>
        <el-button v-if="canTransition('FIXING')" @click="doTransition('FIXING')">开始修复</el-button>
        <el-button v-if="canTransition('FIXED')" @click="showFixedModal = true">标记已修复</el-button>
        <el-button v-if="canTransition('CLOSED')" type="success" @click="doTransition('CLOSED')">关闭</el-button>
        <el-button v-if="canTransition('REOPENED')" type="danger" @click="doTransition('REOPENED')">重新打开</el-button>
      </el-space>
    </div>

    <!-- Assign Modal -->
    <el-dialog v-model="showAssignModal" title="指派负责人">
      <el-form-item label="负责人 ID">
        <el-input v-model="assignForm.assigneeId" placeholder="输入成员 ID" />
      </el-form-item>
      <template #footer>
        <el-button @click="showAssignModal = false">取消</el-button>
        <el-button type="primary" @click="handleAssign">确定</el-button>
      </template>
    </el-dialog>

    <!-- Fixed Modal -->
    <el-dialog v-model="showFixedModal" title="标记已修复">
      <el-form-item label="Commit SHA" required>
        <el-input v-model="fixedForm.commitSha" placeholder="输入修复 commit SHA" />
      </el-form-item>
      <template #footer>
        <el-button @click="showFixedModal = false">取消</el-button>
        <el-button type="primary" @click="handleFixed">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
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

function priorityType(p: string) {
  const map: Record<string, string> = { P0: 'danger', P1: 'warning', P2: 'primary', P3: 'info' }
  return map[p] || 'info'
}

function statusType(s: string) {
  const map: Record<string, string> = {
    OPEN: 'info', ASSIGNED: 'primary', FIXING: 'warning',
    FIXED: 'success', REOPENED: 'warning', CLOSED: 'info'
  }
  return map[s] || 'info'
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
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
})
</script>
