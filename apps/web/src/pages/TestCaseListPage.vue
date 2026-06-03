<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <h2>测试用例</h2>
        <p style="color: #8c8c8c;">管理项目测试用例，支持按模块、优先级筛选。</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 200px;" @change="loadTestCases">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-button v-if="canWrite" type="primary" @click="showCreate = true" :disabled="!selectedProjectId">新建用例</el-button>
      </div>
    </div>

    <el-table :data="testCases" row-key="id" v-loading="loading">
      <el-table-column prop="title" label="标题" />
      <el-table-column prop="module" label="模块" />
      <el-table-column label="优先级">
        <template #default="{ row }">
          <el-tag :type="priorityType(row.priority)">{{ priorityMap[row.priority] || row.priority }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="tags" label="标签" />
      <el-table-column label="状态">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button v-if="canWrite" link size="small" @click="editCase(row)">编辑</el-button>
          <el-popconfirm v-if="canWrite" title="确定删除此测试用例？" @confirm="handleDelete(row.id)">
            <template #reference>
              <el-button link size="small" style="color: #f56c6c;">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && testCases.length === 0 && selectedProjectId" description="暂无测试用例" />
    <el-empty v-if="!selectedProjectId" description="请先选择一个项目" />

    <!-- Create/Edit Modal -->
    <el-dialog v-model="showCreate" :title="editingCase ? '编辑测试用例' : '新建测试用例'" width="640px">
      <el-form label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="测试用例标题" />
        </el-form-item>
        <el-form-item label="模块">
          <el-input v-model="form.module" placeholder="如：登录模块" />
        </el-form-item>
        <el-form-item label="测试步骤">
          <el-input type="textarea" v-model="form.steps" :rows="3" placeholder="1. 打开页面&#10;2. 点击按钮&#10;3. 验证结果" />
        </el-form-item>
        <el-form-item label="预期结果">
          <el-input type="textarea" v-model="form.expectedResult" :rows="2" placeholder="预期结果描述" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="form.priority">
            <el-option value="P0" :label="priorityMap.P0" />
            <el-option value="P1" :label="priorityMap.P1" />
            <el-option value="P2" :label="priorityMap.P2" />
            <el-option value="P3" :label="priorityMap.P3" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="form.tags" placeholder="用逗号分隔，如：冒烟测试, 回归测试" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchProjects, fetchTestCases, createTestCase, updateTestCase, deleteTestCase } from '../api/client'
import { usePermission } from '../composables/usePermission'

const { canWrite } = usePermission()
import { priorityMap } from '../utils/display'

const projects = ref<any[]>([])
const selectedProjectId = ref('')
const testCases = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const editingCase = ref<any>(null)

const form = ref({
  title: '', module: '', steps: '', expectedResult: '', priority: 'P2', tags: ''
})

function priorityType(p: string) {
  const map: Record<string, string> = { P0: 'danger', P1: 'warning', P2: 'primary', P3: 'info' }
  return map[p] || 'info'
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
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
  loading.value = false
}

onMounted(async () => {
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
})
</script>
