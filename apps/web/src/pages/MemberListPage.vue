<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <div>
        <h2 style="margin: 0;">成员管理</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">管理工作空间成员与角色。</p>
      </div>
    </div>

    <a-card>
      <a-table :columns="columns" :data-source="members" :loading="loading" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'user'">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="member-avatar">{{ (record.displayName || record.account || '?').charAt(0).toUpperCase() }}</div>
              <div>
                <div style="font-weight: 500;">{{ record.displayName || record.account }}</div>
                <div style="font-size: 12px; color: #8c8c8c;">{{ record.account }}</div>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'role'">
            <a-tag :color="roleColor(record.role)">{{ roleMap[record.role] || record.role }}</a-tag>
          </template>
          <template v-if="column.key === 'createdAt'">
            {{ formatTime(record.createdAt) }}
          </template>
          <template v-if="column.key === 'actions'">
            <a-space v-if="isOwner && record.role !== 'OWNER'">
              <a-select
                :value="record.role"
                size="small"
                style="width: 120px;"
                @change="(val: string) => handleRoleChange(record.id, val)"
              >
                <a-select-option value="ADMIN">管理员</a-select-option>
                <a-select-option value="DEVELOPER">开发者</a-select-option>
                <a-select-option value="TESTER">测试员</a-select-option>
                <a-select-option value="VIEWER">观察者</a-select-option>
              </a-select>
              <a-popconfirm title="确定移除此成员？" @confirm="handleRemove(record.id)">
                <a-button size="small" danger>移除</a-button>
              </a-popconfirm>
            </a-space>
            <span v-else-if="record.role === 'OWNER'" style="color: #8c8c8c; font-size: 12px;">所有者</span>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { fetchMembers, updateMemberRole, removeMember } from '../api/client'
import { formatTime } from '../utils/display'
import { usePermission } from '../composables/usePermission'

const { isOwner } = usePermission()

const members = ref<any[]>([])
const loading = ref(false)

const roleMap: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  DEVELOPER: '开发者',
  TESTER: '测试员',
  VIEWER: '观察者',
}

const columns = [
  { title: '成员', key: 'user', dataIndex: 'account' },
  { title: '角色', key: 'role', dataIndex: 'role', width: 120 },
  { title: '加入时间', key: 'createdAt', dataIndex: 'createdAt', width: 180 },
  { title: '操作', key: 'actions', width: 240 },
]

function roleColor(role: string) {
  const map: Record<string, string> = {
    OWNER: 'gold', ADMIN: 'blue', DEVELOPER: 'green', TESTER: 'orange', VIEWER: 'default',
  }
  return map[role] || 'default'
}

async function loadMembers() {
  loading.value = true
  try {
    const res = await fetchMembers()
    members.value = res.data || []
  } catch {
    message.error('加载成员列表失败')
  }
  loading.value = false
}

async function handleRoleChange(id: string, role: string) {
  try {
    await updateMemberRole(id, role)
    message.success('角色已更新')
    await loadMembers()
  } catch (e: any) {
    message.error(e.response?.data?.message || '更新角色失败')
  }
}

async function handleRemove(id: string) {
  try {
    await removeMember(id)
    message.success('成员已移除')
    await loadMembers()
  } catch (e: any) {
    if (e.response?.status === 409) {
      message.error('不能移除最后一个所有者')
    } else {
      message.error(e.response?.data?.message || '移除失败')
    }
  }
}

onMounted(() => { loadMembers() })
</script>

<style scoped>
.member-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #99f6e4, #5eead4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  color: #0d9488;
}
</style>
