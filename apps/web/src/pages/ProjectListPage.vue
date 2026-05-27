<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <div>
        <h2 style="margin: 0;">Projects</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">管理项目、绑定 Git 仓库、配置构建与部署参数。</p>
      </div>
      <a-button type="primary" @click="$router.push('/projects/create')">创建项目</a-button>
    </div>
    <a-table :columns="columns" :data-source="projects" row-key="id" :loading="loading" @row-click="(r: any) => $router.push(`/projects/${r.id}`)" style="cursor: pointer;">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'projectType'">
          <a-tag>{{ record.projectType }}</a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click.stop="$router.push(`/projects/${record.id}`)">详情</a-button>
        </template>
      </template>
    </a-table>
    <a-empty v-if="!loading && projects.length === 0" description="暂无项目">
      <a-button type="primary" @click="$router.push('/projects/create')">创建第一个项目</a-button>
    </a-empty>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchProjects } from '../api/client'

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'projectType', key: 'projectType' },
  { title: '仓库地址', dataIndex: 'repositoryUrl', key: 'repositoryUrl', ellipsis: true },
  { title: '操作', key: 'action' },
]

const projects = ref<any[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const res = await fetchProjects()
    projects.value = res.data
  } catch {}
  loading.value = false
})
</script>
