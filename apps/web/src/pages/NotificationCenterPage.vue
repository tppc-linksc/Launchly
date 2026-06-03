<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>通知中心</h2>
      <el-button size="small" @click="handleMarkAllRead" :disabled="unreadCount === 0">全部已读</el-button>
    </div>
    <div v-loading="loading" style="margin-top: 16px;">
      <div v-if="notifications.length > 0">
        <div v-for="item in notifications" :key="item.id" class="list-item">
          <div class="list-item-content">
            <div class="list-item-header">
              <span :style="{ fontWeight: item.read ? 'normal' : 'bold' }">{{ item.title }}</span>
              <el-tag v-if="!item.read" type="primary" size="small" style="margin-left: 8px;">未读</el-tag>
            </div>
            <div class="list-item-body">{{ item.content }}</div>
            <div style="font-size: 12px; color: #999; margin-top: 4px;">{{ formatTime(item.createdAt) }}</div>
          </div>
          <div class="list-item-actions">
            <el-button v-if="!item.read" link type="primary" size="small" @click="handleMarkRead(item.id)">标为已读</el-button>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无通知" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchNotifications, fetchUnreadCount, markNotificationRead, markAllNotificationsRead } from '../api/client'

const notifications = ref<any[]>([])
const unreadCount = ref(0)
const loading = ref(false)

function formatTime(t: string) {
  if (!t) return '-'
  return new Date(t).toLocaleString()
}

async function load() {
  loading.value = true
  try {
    const [listRes, countRes] = await Promise.all([fetchNotifications(), fetchUnreadCount()])
    notifications.value = listRes.data || []
    unreadCount.value = countRes.data?.count || 0
  } catch (e) { console.error(e) }
  loading.value = false
}

async function handleMarkRead(id: string) {
  try {
    await markNotificationRead(id)
    const n = notifications.value.find((x: any) => x.id === id)
    if (n) n.read = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch (e) { console.error(e) }
}

async function handleMarkAllRead() {
  try {
    await markAllNotificationsRead()
    notifications.value.forEach((x: any) => x.read = true)
    unreadCount.value = 0
  } catch (e) { console.error(e) }
}

onMounted(() => { load() })
</script>

<style scoped>
.list-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 0;
  border-bottom: 1px solid #e5e7eb;
}
.list-item:last-child {
  border-bottom: none;
}
.list-item-content {
  flex: 1;
}
.list-item-header {
  display: flex;
  align-items: center;
}
.list-item-body {
  margin-top: 4px;
}
.list-item-actions {
  flex-shrink: 0;
  margin-left: 16px;
}
</style>
