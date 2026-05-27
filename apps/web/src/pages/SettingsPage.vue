<template>
  <div>
    <h2>设置</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">管理工作空间与系统配置。</p>

    <a-row :gutter="16">
      <a-col :span="16">
        <a-card title="工作空间设置" style="margin-bottom: 16px;">
          <a-form layout="vertical" :model="workspaceForm">
            <a-form-item label="工作空间名称">
              <a-input v-model:value="workspaceForm.name" placeholder="例如：My Team" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="saveWorkspace" :loading="saving">保存</a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-card title="个人信息" style="margin-bottom: 16px;">
          <a-descriptions bordered size="small" :column="1">
            <a-descriptions-item label="账号">{{ auth.user?.account || '-' }}</a-descriptions-item>
            <a-descriptions-item label="显示名称">{{ auth.user?.displayName || '-' }}</a-descriptions-item>
            <a-descriptions-item label="角色">
              <a-tag :color="roleColor">{{ roleLabel }}</a-tag>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-col>

      <a-col :span="8">
        <a-card title="系统信息" style="margin-bottom: 16px;">
          <a-descriptions bordered size="small" :column="1">
            <a-descriptions-item label="应用名称">Launchly</a-descriptions-item>
            <a-descriptions-item label="版本">1.0.0-beta</a-descriptions-item>
            <a-descriptions-item label="数据库">PostgreSQL</a-descriptions-item>
            <a-descriptions-item label="数据目录">~/.launchly</a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-card title="快速入口">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <a-button block @click="$router.push('/members')">成员管理</a-button>
            <a-button block @click="$router.push('/audit-logs')">审计日志</a-button>
            <a-button block @click="$router.push('/notifications')">通知中心</a-button>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import { message } from 'ant-design-vue'
import { useAuthStore } from '../stores/auth'
import { usePermission } from '../composables/usePermission'

const auth = useAuthStore()
const { role } = usePermission()

const workspaceForm = reactive({
  name: auth.workspace?.name || '',
})

const saving = false

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    OWNER: '所有者', ADMIN: '管理员', DEVELOPER: '开发者', TESTER: '测试员', VIEWER: '观察者',
  }
  return map[role.value] || role.value
})

const roleColor = computed(() => {
  const map: Record<string, string> = {
    OWNER: 'gold', ADMIN: 'blue', DEVELOPER: 'green', TESTER: 'orange', VIEWER: 'default',
  }
  return map[role.value] || 'default'
})

function saveWorkspace() {
  message.success('工作空间设置已保存')
}
</script>
