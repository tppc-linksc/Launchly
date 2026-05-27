<template>
  <div class="login-page">
    <a-card :title="'登录 Launchly'" style="max-width: 400px; margin: 80px auto;">
      <a-form :model="form" layout="vertical" @finish="onSubmit">
        <a-form-item label="账号" required>
          <a-input v-model:value="form.account" placeholder="邮箱地址" />
        </a-form-item>
        <a-form-item label="密码" required>
          <a-input-password v-model:value="form.password" placeholder="输入密码" />
        </a-form-item>
        <a-form-item>
          <a-button type="primary" html-type="submit" :loading="loading" block>登录</a-button>
        </a-form-item>
      </a-form>
      <a-alert v-if="error" :message="error" type="error" show-icon style="margin-top: 16px" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { login } from '../api/client'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const form = reactive({ account: '', password: '' })
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  loading.value = true
  error.value = ''
  try {
    const res = await login({ account: form.account, password: form.password })
    auth.setAuth(res.data)
    window.location.hash = '#/'
  } catch (e: any) {
    error.value = e.response?.data?.message || '账号或密码错误'
  } finally {
    loading.value = false
  }
}
</script>
