<template>
  <div>
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
      <el-button link @click="() => $router.back()">&larr; 返回</el-button>
      <h2 style="margin: 0;">测试执行详情</h2>
      <el-tag :type="statusType(testRun?.status)">{{ testRunStatusMap[testRun?.status] || testRun?.status }}</el-tag>
    </div>

    <el-descriptions border size="small" :column="2" style="margin-bottom: 24px;">
      <el-descriptions-item label="部署 ID">{{ testRun?.deploymentId }}</el-descriptions-item>
      <el-descriptions-item label="环境">{{ testRun?.environmentId }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ testRun?.createdAt }}</el-descriptions-item>
      <el-descriptions-item label="完成时间">{{ testRun?.finishedAt || '-' }}</el-descriptions-item>
    </el-descriptions>

    <h3 style="margin-bottom: 16px;">测试用例执行</h3>
    <el-table :data="cases" row-key="id" v-loading="loading">
      <el-table-column prop="testCaseId" label="测试用例" show-overflow-tooltip />
      <el-table-column label="结果" width="140">
        <template #default="{ row }">
          <el-select v-model="row.result" size="small" style="width: 100px;" @change="(v: string) => updateResult(row, v)">
            <el-option value="PASSED">
              <span style="color: #52c41a;">{{ testResultMap.PASSED }}</span>
            </el-option>
            <el-option value="FAILED">
              <span style="color: #ff4d4f;">{{ testResultMap.FAILED }}</span>
            </el-option>
            <el-option value="BLOCKED">
              <span style="color: #faad14;">{{ testResultMap.BLOCKED }}</span>
            </el-option>
            <el-option value="SKIPPED" :label="testResultMap.SKIPPED" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="备注">
        <template #default="{ row }">
          <el-input v-model="row.notes" size="small" placeholder="备注" @blur="updateNotes(row)" />
        </template>
      </el-table-column>
      <el-table-column prop="executedBy" label="执行人" />
      <el-table-column prop="executedAt" label="执行时间" />
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button v-if="row.result === 'FAILED'" link size="small" style="color: #f56c6c;" @click="handleCreateIssue(row)">创建 Issue</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && cases.length === 0" description="暂无测试用例" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchTestRun, fetchTestRunCases, fetchTestCases, updateTestRunCase, createIssueFromFailedTest } from '../api/client'
import { testRunStatusMap, testResultMap } from '../utils/display'

const route = useRoute()
const router = useRouter()
const testRun = ref<any>(null)
const cases = ref<any[]>([])
const loading = ref(false)

function statusType(s: string) {
  const map: Record<string, string> = { PENDING: 'info', RUNNING: 'warning', COMPLETED: 'success' }
  return map[s] || 'info'
}

async function updateResult(record: any, result: string) {
  try {
    await updateTestRunCase(route.params.id as string, record.id, {
      result,
      notes: record.notes || '',
    })
  } catch (e: any) {
    console.error('Update test result failed', e)
  }
}

async function updateNotes(record: any) {
  try {
    await updateTestRunCase(route.params.id as string, record.id, {
      result: record.result,
      notes: record.notes || '',
    })
  } catch (e: any) {
    console.error('Update test notes failed', e)
  }
}

async function handleCreateIssue(record: any) {
  try {
    const res = await createIssueFromFailedTest(
      record.projectId || testRun.value?.projectId,
      record.id,
      testRun.value?.deploymentId,
      record.testCaseId,
    )
    ElMessage.success('Issue 已创建')
    router.push(`/issues/${res.data.id}`)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '创建 Issue 失败')
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const [runRes, casesRes] = await Promise.all([
      fetchTestRun(route.params.id as string),
      fetchTestRunCases(route.params.id as string),
    ])
    testRun.value = runRes.data
    cases.value = casesRes.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
})
</script>
