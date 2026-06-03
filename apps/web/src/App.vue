<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const router = useRouter()
const auth = useAuthStore()

onMounted(async () => {
  await auth.checkSetupStatus()
  if (!auth.initialized) {
    router.replace('/init')
  } else if (!auth.user && !localStorage.getItem('accessToken')) {
    router.replace('/login')
  }
})
</script>

<style>
:root {
  --el-color-primary: #0D9488;
  --el-color-success: #059669;
  --el-color-warning: #D97706;
  --el-color-danger: #DC2626;
  --el-border-radius-base: 8px;
}
body {
  margin: 0;
  background: #F8F9FB;
}
</style>
