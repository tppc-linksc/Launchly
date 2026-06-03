<template>
  <div class="app-shell">
    <!-- Topbar -->
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Launch<span class="teal">ly</span></div>
        <div class="global-search-wrap">
          <el-input
            v-model="searchQuery"
            placeholder="搜索部署、项目、分支…"
            clearable
            class="global-search"
          >
            <template #prefix><span style="color: #9ca3af;">&#9906;</span></template>
          </el-input>
        </div>
        <div class="top-actions">
          <el-button v-if="canDeploy" type="primary" class="btn-pill" @click="$router.push('/deployments')">触发部署</el-button>
          <el-button class="btn-pill-ghost" @click="$router.push('/projects/create')">连接仓库</el-button>
          <el-dropdown>
            <div class="avatar-wrap">
              <div class="avatar">{{ avatarLetter }}</div>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>{{ auth.user?.displayName || auth.user?.account }}</el-dropdown-item>
                <el-dropdown-item divided @click="$router.push('/settings')">设置</el-dropdown-item>
                <el-dropdown-item @click="$router.push('/members')">成员管理</el-dropdown-item>
                <el-dropdown-item @click="$router.push('/audit-logs')">审计日志</el-dropdown-item>
                <el-dropdown-item @click="$router.push('/notifications')">通知</el-dropdown-item>
                <el-dropdown-item divided @click="auth.logout()">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <nav class="nav-row">
        <button
          v-for="item in navItems"
          :key="item.key"
          :class="['nav-pill', { active: activeKey === item.key }]"
          @click="onNavClick(item.key)"
        >{{ item.label }}</button>
      </nav>
    </header>

    <!-- Page content -->
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { usePermission } from '../composables/usePermission'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const { canDeploy } = usePermission()
const searchQuery = ref('')

const navItems = [
  { key: 'overview', label: '概览', path: '/' },
  { key: 'deployments', label: '部署与运行', path: '/deployments' },
  { key: 'projects', label: '项目', path: '/projects' },
  { key: 'environments', label: '环境管理', path: '/environments' },
  { key: 'releases', label: '发布', path: '/releases' },
  { key: 'quality', label: '测试与 Issue', path: '/tests' },
  { key: 'targets', label: '部署目标', path: '/projects' },
]

const activeKey = computed(() => {
  const path = route.path
  if (path === '/' || path === '') return 'overview'
  if (path.startsWith('/deploy-targets')) return 'targets'
  if (path.startsWith('/targets')) return 'targets'
  if (path.startsWith('/deployments')) return 'deployments'
  if (path.startsWith('/environments')) return 'environments'
  if (path.startsWith('/projects')) return 'projects'
  if (path.startsWith('/releases')) return 'releases'
  if (path.startsWith('/tests') || path.startsWith('/issues')) return 'quality'
  return 'overview'
})

const avatarLetter = computed(() => {
  const name = auth.user?.displayName || auth.user?.account || '?'
  return name.charAt(0).toUpperCase()
})

function onNavClick(key: string) {
  const item = navItems.find(i => i.key === key)
  if (item) router.push(item.path)
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #f8f9fb;
}

/* Topbar */
.topbar {
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  z-index: 20;
}
.topbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 20px;
}
.brand {
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -0.02em;
  color: #111827;
  white-space: nowrap;
}
.brand .teal { color: #0d9488; }

.global-search-wrap {
  flex: 1;
  min-width: 200px;
  max-width: 420px;
}
.global-search :deep(.el-input__wrapper) {
  border-radius: 999px;
  background: #f9fafb;
  box-shadow: 0 0 0 1px #e5e7eb;
  padding: 4px 14px;
}
.global-search :deep(.el-input__wrapper:focus-within) {
  border-color: #0d9488;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.btn-pill {
  border-radius: 999px;
  font-weight: 600;
  background: #0d9488;
  border-color: #0d9488;
}
.btn-pill:hover {
  background: #0f766e;
  border-color: #0f766e;
}
.btn-pill-ghost {
  border-radius: 999px;
  font-weight: 500;
  color: #6b7280;
  border-color: #e5e7eb;
}
.btn-pill-ghost:hover {
  color: #0d9488;
  border-color: #0d9488;
}

.avatar-wrap { cursor: pointer; }
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #99f6e4, #5eead4);
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  color: #0d9488;
}

/* Navigation pills */
.nav-row {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.nav-pill {
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}
.nav-pill:hover { color: #111827; background: #f3f4f6; }
.nav-pill.active {
  color: #0d9488;
  background: #ccfbf1;
}

/* Content */
.content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}

/* Responsive */
@media (max-width: 768px) {
  .topbar-inner {
    padding: 10px 16px;
    gap: 12px;
  }
  .brand { font-size: 18px; }
  .global-search-wrap { min-width: 140px; max-width: none; }
  .btn-pill, .btn-pill-ghost { padding: 6px 12px; font-size: 13px; }
  .nav-row { padding: 0 16px 10px; gap: 4px; }
  .nav-pill { padding: 6px 12px; font-size: 13px; }
  .content { padding: 16px; }
}
</style>
