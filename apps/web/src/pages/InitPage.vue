<template>
  <div class="init-page">
    <a-card :title="'初始化 Launchly'" style="max-width: 480px; margin: 80px auto;">
      <a-form :model="form" layout="vertical" @finish="onSubmit">
        <a-form-item label="账号" required>
          <a-input v-model:value="form.account" placeholder="邮箱地址" />
        </a-form-item>
        <a-form-item label="密码" required>
          <a-input-password v-model:value="form.password" placeholder="至少 8 位，需包含字母和数字" />
        </a-form-item>
        <a-form-item label="显示名称">
          <a-input v-model:value="form.displayName" placeholder="可选" />
        </a-form-item>
        <a-form-item label="默认 Workspace 名称" required>
          <a-input v-model:value="form.workspaceName" placeholder="例如：My Team" />
        </a-form-item>
        <a-form-item>
          <a-button type="primary" html-type="submit" :loading="loading" block>创建管理员并初始化</a-button>
        </a-form-item>
      </a-form>
      <a-alert v-if="error" :message="error" type="error" show-icon style="margin-top: 16px" />
      <a-result v-if="success" status="success" title="初始化完成">
        <template #extra>
          <a-button type="primary" @click="$router.push('/login')">前往登录</a-button>
        </template>
      </a-result>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { createOwner } from '../api/client'

const form = reactive({
  account: '',
  password: '',
  displayName: '',
  workspaceName: '',
})

const loading = ref(false)
const error = ref('')
const success = ref(false)

async function onSubmit() {
  loading.value = true
  error.value = ''
  try {
    await createOwner({
      account: form.account,
      password: form.password,
      displayName: form.displayName || undefined,
      workspaceName: form.workspaceName,
    })
    success.value = true
  } catch (e: any) {
    error.value = e.response?.data?.message || '初始化失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>
