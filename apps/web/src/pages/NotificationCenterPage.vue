<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>通知中心</h2>
      <a-button size="small" @click="handleMarkAllRead" :disabled="unreadCount === 0">全部已读</a-button>
    </div>
    <a-list style="margin-top: 16px;" :loading="loading" item-layout="horizontal" :data-source="notifications">
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #title>
              <span :style="{ fontWeight: item.read ? 'normal' : 'bold' }">{{ item.title }}</span>
              <a-tag v-if="!item.read" color="blue" style="margin-left: 8px;">未读</a-tag>
            </template>
            <template #description>
              <div>{{ item.content }}</div>
              <div style="font-size: 12px; color: #999; margin-top: 4px;">{{ formatTime(item.createdAt) }}</div>
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-button v-if="!item.read" type="link" size="small" @click="handleMarkRead(item.id)">标为已读</a-button>
          </template>
        </a-list-item>
      </template>
      <template #empty>
        <a-empty description="暂无通知" />
      </template>
    </a-list>
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
