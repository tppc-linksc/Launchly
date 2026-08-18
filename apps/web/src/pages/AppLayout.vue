<template>
  <div class="app-shell">
    <!-- Topbar -->
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Launch<span class="teal">ly</span></div>
        <div class="global-search-wrap" @keydown.esc="closeSearch">
          <el-input
            ref="searchInputRef"
            v-model="searchQuery"
            placeholder="搜索部署、项目、分支、节点、commit…"

            clearable
            class="global-search"
            @focus="searchOpen = true"
            @input="searchOpen = true"
            @clear="closeSearch"
          >
            <template #prefix><span style="color: #9ca3af;">&#9906;</span></template>
          </el-input>

          <!-- 搜索结果下拉：项目 / 服务 / 部署 / 节点 / 分支 / commit / 域名 -->
          <div v-if="searchOpen && searchQuery.trim()" class="search-dropdown" v-loading="searchLoading">
            <div v-if="searchError" class="search-empty">
              <span class="search-empty-text">搜索失败：{{ searchError }}</span>
            </div>
            <div v-else-if="!searchLoading && searchResults.length === 0" class="search-empty">
              <span class="search-empty-text">没有匹配的资源</span>
            </div>
            <ul v-else class="search-results" data-testid="global-search-results">
              <li
                v-for="r in searchResults"
                :key="r.id"
                class="search-item"
                @click="onSelectResult(r)"
              >
                <span :class="['cat-tag', 'cat-' + r.category]">{{ categoryLabel(r.category) }}</span>
                <div class="search-item-text">
                  <span class="search-item-title">{{ r.title }}</span>
                  <span v-if="r.subtitle" class="search-item-subtitle">{{ r.subtitle }}</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
        <div class="top-actions">
          <el-button v-if="canDeploy" type="primary" class="btn-pill" @click="$router.push('/deployments')">触发部署</el-button>
          <el-button class="btn-pill-ghost" @click="$router.push('/resources/new')">新建资源</el-button>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { usePermission } from '../composables/usePermission'
import { useGlobalSearch, ResultCategory, SearchResult } from '../composables/useGlobalSearch'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const { canDeploy } = usePermission()

// KI-014 全局搜索组合式。
// 用 ref 双向绑定的 searchQuery 直接传给 composable 的 query；
// results 已经是按类别排序的前 30 条。
const {
  query: composableQuery,
  results: searchResults,
  loading: searchLoading,
  error: searchError,
  refresh: refreshSearch,
} = useGlobalSearch()

// 全局 v-model 与 composable 的 query 同步
const searchQuery = computed<string>({
  get: () => composableQuery.value,
  set: (v: string) => { composableQuery.value = v },
})

const searchOpen = ref(false)
const searchInputRef = ref<any>(null)

// 类别文本（用于彩色 chip）
const categoryLabels: Record<ResultCategory, string> = {
  project: '项目',
  service: '服务',
  deployment: '部署',
  node: '节点',
  branch: '分支',
  commit: 'commit',
  domain: '域名',
}
function categoryLabel(c: ResultCategory): string { return categoryLabels[c] || c }

// 点击搜索结果：跳转目标页 + 关闭浮层
function onSelectResult(r: SearchResult) {
  router.push(r.path)
  closeSearch()
}

// 关闭搜索下拉（保留 query 以便 Tab 切换后还能显示）
function closeSearch() {
  searchOpen.value = false
  // 不主动清空 query，让用户保留输入恢复时还在
}

// 点击外部关闭：用一个全局 click 监听
function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target) return
  if (target.closest('.global-search-wrap')) return
  searchOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})

const navItems = [
  { key: 'overview', label: '概览', path: '/' },
  { key: 'deployments', label: '部署与运行', path: '/deployments' },
  { key: 'projects', label: '项目', path: '/projects' },
  { key: 'environments', label: '环境管理', path: '/environments' },
  { key: 'releases', label: '发布', path: '/releases' },
  { key: 'quality', label: '测试与 Issue', path: '/tests' },
  { key: 'targets', label: '部署目标', path: '/deploy-targets' },
]

const activeKey = computed(() => {
  const path = route.path
  if (path === '/') return 'overview'
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

// 保留旧字段名以向兼容
const _legacySearchQuery = searchQuery
void _legacySearchQuery
void route
void searchInputRef
void refreshSearch
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

/* 搜索包裹 + 下拉 */
.global-search-wrap {
  flex: 1;
  min-width: 200px;
  max-width: 420px;
  position: relative;
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

/* 搜索结果下拉（KI-014 关闭条件） */
.search-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  max-height: 360px;
  overflow-y: auto;
  z-index: 30;
  padding: 4px 0;
}
.search-results { list-style: none; margin: 0; padding: 0; }
.search-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.1s;
}
.search-item:hover { background: #f3f4f6; }
.search-item-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.search-item-title {
  font-size: 14px;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-item-subtitle {
  font-size: 12px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 类别彩色 chip */
.cat-tag {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  letter-spacing: 0.04em;
}
.cat-project { background: #ccfbf1; color: #0f766e; }
.cat-service { background: #dbeafe; color: #1d4ed8; }
.cat-deployment { background: #fef3c7; color: #b45309; }
.cat-node { background: #f3e8ff; color: #6b21a8; }
.cat-branch { background: #dcfce7; color: #166534; }
.cat-commit { background: #fee2e2; color: #b91c1c; }
.cat-domain { background: #e0e7ff; color: #4338ca; }
.search-empty { padding: 16px; text-align: center; }
.search-empty-text { color: #9ca3af; font-size: 13px; }

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
