<template>
  <div>
    <h2>{{ title }}</h2>
    <p style="color: #8c8c8c;">此模块尚未实现，将在后续开发计划中逐步完成。</p>
    <a-card style="margin-top: 16px;"><p>占位区域 — 功能开发中</p></a-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const titles: Record<string, string> = {
  tests: 'Tests', issues: 'Issues', releases: 'Releases', members: 'Members', settings: 'Settings',
}
const title = computed(() => titles[String(route.name)] || '页面')
</script>
