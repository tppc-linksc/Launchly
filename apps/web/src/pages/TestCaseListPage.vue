<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>测试用例</h2>
        <p style="color: #8c8c8c;">管理项目测试用例，支持按模块、优先级筛选。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <a-select v-model:value="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadTestCases">
          <a-select-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
        </a-select>
        <a-button type="primary" @click="showCreate = true" :disabled="!selectedProjectId">新建用例</a-button>
      </div>
    </div>

    <a-table :columns="columns" :data-source="testCases" row-key="id" :loading="loading">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'priority'">
          <a-tag :color="priorityColor(record.priority)">{{ record.priority }}</a-tag>
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="record.status === 'ACTIVE' ? 'green' : 'default'">{{ record.status }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="editCase(record)">编辑</a-button>
          <a-popconfirm title="确定删除此测试用例？" @confirm="handleDelete(record.id)">
            <a-button type="link" size="small" danger>删除</a-button>
          </a-popconfirm>
        </template>
      </template>
    </a-table>

    <a-empty v-if="!loading && testCases.length === 0 && selectedProjectId" description="暂无测试用例" />
    <a-empty v-if="!selectedProjectId" description="请先选择一个项目" />

    <!-- Create/Edit Modal -->
    <a-modal v-model:open="showCreate" :title="editingCase ? '编辑测试用例' : '新建测试用例'" width="640px" @ok="handleSave">
      <a-form layout="vertical">
        <a-form-item label="标题" required>
          <a-input v-model:value="form.title" placeholder="测试用例标题" />
        </a-form-item>
        <a-form-item label="模块">
          <a-input v-model:value="form.module" placeholder="如：登录模块" />
        </a-form-item>
        <a-form-item label="测试步骤">
          <a-textarea v-model:value="form.steps" :rows="3" placeholder="1. 打开页面\n2. 点击按钮\n3. 验证结果" />
        </a-form-item>
        <a-form-item label="预期结果">
          <a-textarea v-model:value="form.expectedResult" :rows="2" placeholder="预期结果描述" />
        </a-form-item>
        <a-form-item label="优先级">
          <a-select v-model:value="form.priority">
            <a-select-option value="P0">P0 - 阻塞</a-select-option>
            <a-select-option value="P1">P1 - 高</a-select-option>
            <a-select-option value="P2">P2 - 中</a-select-option>
            <a-select-option value="P3">P3 - 低</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="标签">
          <a-input v-model:value="form.tags" placeholder="用逗号分隔，如：冒烟测试, 回归测试" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchProjects, fetchTestCases, createTestCase, updateTestCase, deleteTestCase } from '../api/client'

const columns = [
  { title: '标题', dataIndex: 'title' },
  { title: '模块', dataIndex: 'module' },
  { title: '优先级', dataIndex: 'priority', key: 'priority' },
  { title: '标签', dataIndex: 'tags' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '操作', key: 'action', width: 150 },
]

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const testCases = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const editingCase = ref<any>(null)

const form = ref({
  title: '', module: '', steps: '', expectedResult: '', priority: 'P2', tags: ''
})

function priorityColor(p: string) {
  const map: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' }
  return map[p] || 'default'
}

function editCase(tc: any) {
  editingCase.value = tc
  form.value = {
    title: tc.title, module: tc.module || '', steps: tc.steps || '',
    expectedResult: tc.expectedResult || '', priority: tc.priority, tags: tc.tags || ''
  }
  showCreate.value = true
}

async function handleSave() {
  try {
    if (editingCase.value) {
      await updateTestCase(selectedProjectId.value, editingCase.value.id, form.value)
    } else {
      await createTestCase(selectedProjectId.value, form.value)
    }
    showCreate.value = false
    editingCase.value = null
    form.value = { title: '', module: '', steps: '', expectedResult: '', priority: 'P2', tags: '' }
    loadTestCases()
  } catch (e: any) {
    console.error('Save test case failed', e)
  }
}

async function handleDelete(id: string) {
  try {
    await deleteTestCase(selectedProjectId.value, id)
    loadTestCases()
  } catch (e: any) {
    console.error('Delete test case failed', e)
  }
}

async function loadTestCases() {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    const res = await fetchTestCases(selectedProjectId.value)
    testCases.value = res.data
  } catch {}
  loading.value = false
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch {}
})
</script>
