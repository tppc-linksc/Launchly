<template>
  <a-layout class="app-shell">
    <a-layout-sider width="220" theme="light">
      <div class="brand">Launchly</div>
      <a-menu mode="inline" :selected-keys="[activeKey]" @click="onMenuClick">
        <a-menu-item key="dashboard">Dashboard</a-menu-item>
        <a-menu-item key="projects">Projects</a-menu-item>
        <a-menu-item key="deployments">Deployments</a-menu-item>
        <a-menu-item key="environments">Environments</a-menu-item>
        <a-menu-item key="tests">Tests</a-menu-item>
        <a-menu-item key="issues">Issues</a-menu-item>
        <a-menu-item key="releases">Releases</a-menu-item>
        <a-menu-item key="members">Members</a-menu-item>
        <a-menu-item key="settings">Settings</a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="topbar">
        <div class="topbar-left">
          <span class="workspace-label">{{ auth.workspace?.name || 'Default Workspace' }}</span>
        </div>
        <div class="topbar-right">
          <a-tag color="processing">pre-alpha</a-tag>
          <a-button v-if="auth.user" type="link" @click="auth.logout()">退出</a-button>
        </div>
      </a-layout-header>
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/projects')) return 'projects'
  if (path.startsWith('/deployments')) return 'deployments'
  if (path.startsWith('/environments')) return 'environments'
  if (path.startsWith('/tests')) return 'tests'
  if (path.startsWith('/issues')) return 'issues'
  if (path.startsWith('/releases')) return 'releases'
  if (path.startsWith('/members')) return 'members'
  if (path.startsWith('/settings')) return 'settings'
  return 'dashboard'
})

function onMenuClick({ key }: { key: string }) {
  router.push(`/${key === 'dashboard' ? '' : key}`)
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-weight: 700;
  font-size: 16px;
  border-bottom: 1px solid #f0f0f0;
}
.topbar {
  height: 56px;
  line-height: 56px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.workspace-label {
  font-weight: 500;
}
.content {
  padding: 24px;
  background: #f5f5f5;
}
</style>
