<template>
  <el-card header="加入 Launchly 工作空间" style="max-width: 420px; margin: 80px auto;">
    <el-form :model="form" label-position="top" @submit.prevent="submit">
      <el-form-item label="账号" required><el-input v-model="form.account" /></el-form-item>
      <el-form-item label="显示名称"><el-input v-model="form.displayName" /></el-form-item>
      <el-form-item label="密码" required><el-input v-model="form.password" type="password" show-password /></el-form-item>
      <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%;">接受邀请</el-button>
    </el-form>
    <el-alert v-if="message" :title="message" :type="succeeded ? 'success' : 'error'" show-icon style="margin-top: 16px" />
    <el-button v-if="succeeded" link type="primary" style="margin-top: 12px" @click="$router.push('/login')">前往登录</el-button>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { acceptInvitation } from '../api/client'

const route = useRoute()
const form = reactive({ account: '', displayName: '', password: '' })
const loading = ref(false)
const message = ref('')
const succeeded = ref(false)

async function submit() {
  loading.value = true
  message.value = ''
  try {
    await acceptInvitation(String(route.params.token || ''), form)
    succeeded.value = true
    message.value = '加入成功，请使用新账号登录'
  } catch (error: any) {
    succeeded.value = false
    message.value = error.response?.data?.message || '邀请无效或已过期'
  } finally {
    loading.value = false
  }
}
</script>
