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
