<template>
  <div>
    <a-page-header title="测试执行详情" @back="() => $router.back()">
      <template #extra>
        <a-tag :color="statusColor(testRun?.status)">{{ testRun?.status }}</a-tag>
      </template>
    </a-page-header>

    <a-descriptions bordered size="small" :column="2" style="margin-bottom: 24px;">
      <a-descriptions-item label="部署 ID">{{ testRun?.deploymentId }}</a-descriptions-item>
      <a-descriptions-item label="环境">{{ testRun?.environmentId }}</a-descriptions-item>
      <a-descriptions-item label="创建时间">{{ testRun?.createdAt }}</a-descriptions-item>
      <a-descriptions-item label="完成时间">{{ testRun?.finishedAt || '-' }}</a-descriptions-item>
    </a-descriptions>

    <h3 style="margin-bottom: 16px;">测试用例执行</h3>
    <a-table :columns="columns" :data-source="cases" row-key="id" :loading="loading">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'result'">
          <a-select v-model:value="record.result" size="small" style="width: 100px;" @change="(v: string) => updateResult(record, v)">
            <a-select-option value="PASSED">
              <span style="color: #52c41a;">PASSED</span>
            </a-select-option>
            <a-select-option value="FAILED">
              <span style="color: #ff4d4f;">FAILED</span>
            </a-select-option>
            <a-select-option value="BLOCKED">
              <span style="color: #faad14;">BLOCKED</span>
            </a-select-option>
            <a-select-option value="SKIPPED">SKIPPED</a-select-option>
          </a-select>
        </template>
        <template v-if="column.key === 'notes'">
          <a-input v-model:value="record.notes" size="small" placeholder="备注" @blur="updateNotes(record)" />
        </template>
      </template>
    </a-table>

    <a-empty v-if="!loading && cases.length === 0" description="暂无测试用例" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchTestRun, fetchTestRunCases, fetchTestCases, updateTestRunCase } from '../api/client'

const route = useRoute()
const testRun = ref<any>(null)
const cases = ref<any[]>([])
const loading = ref(false)

const columns = [
  { title: '测试用例', dataIndex: 'testCaseId', ellipsis: true },
  { title: '结果', dataIndex: 'result', key: 'result', width: 140 },
  { title: '备注', dataIndex: 'notes', key: 'notes' },
  { title: '执行人', dataIndex: 'executedBy' },
  { title: '执行时间', dataIndex: 'executedAt' },
]

function statusColor(s: string) {
  const map: Record<string, string> = { PENDING: 'default', RUNNING: 'processing', COMPLETED: 'success' }
  return map[s] || 'default'
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

onMounted(async () => {
  loading.value = true
  try {
    const [runRes, casesRes] = await Promise.all([
      fetchTestRun(route.params.id as string),
      fetchTestRunCases(route.params.id as string),
    ])
    testRun.value = runRes.data
    cases.value = casesRes.data
  } catch {}
  loading.value = false
})
</script>
