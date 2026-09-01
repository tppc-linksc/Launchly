<template>
  <div>
    <h2>设置</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">管理工作空间与系统配置。</p>

    <el-row :gutter="16">
      <el-col :span="16">
        <el-card header="工作空间设置" style="margin-bottom: 16px;">
          <el-form label-position="top" :model="workspaceForm">
            <el-form-item label="工作空间名称">
              <el-input v-model="workspaceForm.name" placeholder="例如：My Team" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveWorkspace" :loading="saving">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card header="个人信息" style="margin-bottom: 16px;">
          <el-descriptions border size="small" :column="1">
            <el-descriptions-item label="账号">{{ auth.user?.account || '-' }}</el-descriptions-item>
            <el-descriptions-item label="显示名称">{{ auth.user?.displayName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="角色">
              <el-tag :type="roleType">{{ roleLabel }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card header="系统信息" style="margin-bottom: 16px;">
          <el-descriptions border size="small" :column="1">
            <el-descriptions-item label="应用名称">Launchly</el-descriptions-item>
            <el-descriptions-item label="版本">{{ systemInfo.version || '-' }}</el-descriptions-item>
            <el-descriptions-item label="数据库">PostgreSQL</el-descriptions-item>
            <el-descriptions-item label="数据目录">~/.launchly</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card header="快速入口">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <el-button style="width: 100%;" @click="$router.push('/members')">成员管理</el-button>
            <el-button style="width: 100%;" @click="$router.push('/audit-logs')">审计日志</el-button>
            <el-button style="width: 100%;" @click="$router.push('/notifications')">通知中心</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { usePermission } from '../composables/usePermission'
import { fetchSystemInfo, updateWorkspace } from '../api/client'

const auth = useAuthStore()
const { role } = usePermission()

const workspaceForm = reactive({
  name: auth.workspace?.name || '',
})

const saving = ref(false)
const systemInfo = reactive({ version: '' })

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    OWNER: '所有者', ADMIN: '管理员', DEVELOPER: '开发者', TESTER: '测试员', VIEWER: '观察者',
  }
  return map[role.value] || role.value
})

const roleType = computed(() => {
  const map: Record<string, string> = {
    OWNER: 'warning', ADMIN: 'primary', DEVELOPER: 'success', TESTER: 'warning', VIEWER: 'info',
  }
  return map[role.value] || 'info'
})

async function saveWorkspace() {
  saving.value = true
  try {
    const name = workspaceForm.name.trim()
    if (!name) throw new Error('工作空间名称不能为空')
    const response = await updateWorkspace({ name })
    workspaceForm.name = response.data.name
    if (auth.workspace) auth.workspace.name = response.data.name
    ElMessage.success('工作空间设置已保存')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const response = await fetchSystemInfo()
    systemInfo.version = response.data.version || ''
  } catch { /* 系统信息不可用不影响设置页 */ }
})
</script>
