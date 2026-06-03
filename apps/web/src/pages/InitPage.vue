<template>
  <div class="init-page">
    <el-card header="初始化 Launchly" style="max-width: 480px; margin: 80px auto;">
      <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="账号" required>
          <el-input v-model="form.account" placeholder="邮箱地址" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input type="password" show-password v-model="form.password" placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="form.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="默认 Workspace 名称" required>
          <el-input v-model="form.workspaceName" placeholder="例如：My Team" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%;">创建管理员并初始化</el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" show-icon style="margin-top: 16px" />
      <el-result v-if="success" status="success" title="初始化完成">
        <template #extra>
          <el-button type="primary" @click="$router.push('/login')">前往登录</el-button>
        </template>
      </el-result>
    </el-card>
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
