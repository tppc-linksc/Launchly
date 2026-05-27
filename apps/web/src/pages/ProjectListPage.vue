<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <div>
        <h2 style="margin: 0;">项目</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">管理项目、绑定 Git 仓库、配置构建与部署参数。</p>
      </div>
      <a-button v-if="canWrite" type="primary" @click="$router.push('/projects/create')">创建项目</a-button>
    </div>

    <a-spin :spinning="loading">
      <div class="project-grid">
        <div v-for="project in projects" :key="project.id" class="project-card" @click="$router.push(`/projects/${project.id}`)">
          <div class="card-header">
            <div class="card-title">{{ project.name }}</div>
            <a-tag size="small">{{ project.projectType }}</a-tag>
          </div>
          <div class="card-desc">{{ project.repositoryUrl || '未配置仓库' }}</div>
          <div class="card-deploy">
            <template v-if="lastDeployMap[project.id]">
              <a-tag :color="statusColor(lastDeployMap[project.id].status)" size="small">
                {{ deployStatusMap[lastDeployMap[project.id].status] || lastDeployMap[project.id].status }}
              </a-tag>
              <span class="card-deploy-branch">{{ lastDeployMap[project.id].branch || '-' }}</span>
            </template>
            <span v-else class="card-no-deploy">暂无部署</span>
          </div>
          <div class="card-footer">
            <span class="card-time">{{ project.createdAt ? formatTime(project.createdAt) : '' }}</span>
            <div class="card-actions">
              <a-button v-if="canDeploy" size="small" type="primary" @click.stop="$router.push(`/projects/${project.id}`)">部署</a-button>
              <a-button size="small" @click.stop="$router.push(`/projects/${project.id}`)">详情</a-button>
            </div>
          </div>
        </div>
      </div>
    </a-spin>

    <a-empty v-if="!loading && projects.length === 0" description="暂无项目">
      <a-button v-if="canWrite" type="primary" @click="$router.push('/projects/create')">创建第一个项目</a-button>
    </a-empty>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchProjects, fetchDeployments } from '../api/client'
import { deployStatusMap, formatTime } from '../utils/display'
import { usePermission } from '../composables/usePermission'

const { canWrite, canDeploy } = usePermission()

const projects = ref<any[]>([])
const deployments = ref<any[]>([])
const loading = ref(false)

const lastDeployMap = computed(() => {
  const map: Record<string, any> = {}
  for (const d of deployments.value) {
    if (!map[d.projectId]) map[d.projectId] = d
  }
  return map
})

function statusColor(s: string) {
  const map: Record<string, string> = {
    PENDING: 'default', RUNNING: 'processing', SUCCEEDED: 'success',
    FAILED: 'error', CANCELED: 'warning',
  }
  return map[s] || 'default'
}

onMounted(async () => {
  loading.value = true
  try {
    const [pRes, dRes] = await Promise.all([
      fetchProjects().catch(() => ({ data: [] })),
      fetchDeployments().catch(() => ({ data: [] })),
    ])
    projects.value = pRes.data || []
    deployments.value = dRes.data || []
  } catch {}
  loading.value = false
})
</script>

<style scoped>
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.project-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.project-card:hover {
  border-color: #0d9488;
  box-shadow: 0 2px 8px rgba(13, 148, 136, 0.1);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.card-title {
  font-weight: 600;
  font-size: 16px;
  color: #111827;
}
.card-desc {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-deploy {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 22px;
}
.card-deploy-branch {
  font-size: 13px;
  color: #6b7280;
}
.card-no-deploy {
  font-size: 13px;
  color: #9ca3af;
}
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-time {
  font-size: 12px;
  color: #9ca3af;
}
.card-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .project-grid {
    grid-template-columns: 1fr;
  }
  .card-desc {
    white-space: normal;
  }
}
</style>
