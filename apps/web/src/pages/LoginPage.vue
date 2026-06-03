<template>
  <div class="login-page">
    <el-card header="登录 Launchly" style="max-width: 400px; margin: 80px auto;">
      <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="账号" required>
          <el-input v-model="form.account" placeholder="邮箱地址" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input type="password" show-password v-model="form.password" placeholder="输入密码" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%;">登录</el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" show-icon style="margin-top: 16px" />
    </el-card>
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
