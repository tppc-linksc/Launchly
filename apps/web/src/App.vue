<template>
  <a-config-provider :theme="theme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const router = useRouter()
const auth = useAuthStore()

const theme = {
  token: {
    colorPrimary: '#0D9488',
    colorLink: '#0D9488',
    colorSuccess: '#059669',
    colorWarning: '#D97706',
    colorError: '#DC2626',
    borderRadius: 8,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
  },
}

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
body {
  margin: 0;
  background: #F8F9FB;
}
</style>
