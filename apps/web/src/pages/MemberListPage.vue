<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <div>
        <h2 style="margin: 0;">成员管理</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">管理工作空间成员与角色。</p>
      </div>
    </div>

    <el-card>
      <el-table :data="members" v-loading="loading" row-key="id" size="default">
        <el-table-column label="成员">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="member-avatar">{{ (row.displayName || row.account || '?').charAt(0).toUpperCase() }}</div>
              <div>
                <div style="font-weight: 500;">{{ row.displayName || row.account }}</div>
                <div style="font-size: 12px; color: #8c8c8c;">{{ row.account }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="roleType(row.role)">{{ roleMap[row.role] || row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="加入时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240">
          <template #default="{ row }">
            <el-space v-if="isOwner && row.role !== 'OWNER'">
              <el-select
                :model-value="row.role"
                size="small"
                style="width: 120px;"
                @change="(val: string) => handleRoleChange(row.id, val)"
              >
                <el-option value="ADMIN" label="管理员" />
                <el-option value="DEVELOPER" label="开发者" />
                <el-option value="TESTER" label="测试员" />
                <el-option value="VIEWER" label="观察者" />
              </el-select>
              <el-popconfirm title="确定移除此成员？" @confirm="handleRemove(row.id)">
                <template #reference>
                  <el-button size="small" type="danger">移除</el-button>
                </template>
              </el-popconfirm>
            </el-space>
            <span v-else-if="row.role === 'OWNER'" style="color: #8c8c8c; font-size: 12px;">所有者</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
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

function roleType(role: string) {
  const map: Record<string, string> = {
    OWNER: 'warning', ADMIN: 'primary', DEVELOPER: 'success', TESTER: 'warning', VIEWER: 'info',
  }
  return (map[role] || 'info') as any
}

async function loadMembers() {
  loading.value = true
  try {
    const res = await fetchMembers()
    members.value = res.data || []
  } catch {
    ElMessage.error('加载成员列表失败')
  }
  loading.value = false
}

async function handleRoleChange(id: string, role: string) {
  try {
    await updateMemberRole(id, role)
    ElMessage.success('角色已更新')
    await loadMembers()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '更新角色失败')
  }
}

async function handleRemove(id: string) {
  try {
    await removeMember(id)
    ElMessage.success('成员已移除')
    await loadMembers()
  } catch (e: any) {
    if (e.response?.status === 409) {
      ElMessage.error('不能移除最后一个所有者')
    } else {
      ElMessage.error(e.response?.data?.message || '移除失败')
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
