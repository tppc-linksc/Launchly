<template>
  <div v-if="project">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
      <div>
        <h2 style="margin: 0;">{{ project.name }}</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">{{ project.description || '暂无描述' }}</p>
      </div>
      <div>
        <a-tag>{{ project.projectType }}</a-tag>
        <a-button type="primary" style="margin-left: 8px;" @click="showDeploy = true" :disabled="!project.repositoryUrl">部署到 Test</a-button>
      </div>
    </div>

    <a-row :gutter="16">
      <a-col :span="16">
        <a-card title="项目信息" style="margin-bottom: 16px;">
          <a-descriptions :column="2" size="small">
            <a-descriptions-item label="仓库地址">{{ project.repositoryUrl || '未配置' }}</a-descriptions-item>
            <a-descriptions-item label="默认分支">{{ project.defaultBranch }}</a-descriptions-item>
            <a-descriptions-item label="Git 提供方">{{ project.gitProvider || '未选择' }}</a-descriptions-item>
            <a-descriptions-item label="健康检查路径">{{ project.healthCheckPath || '未配置' }}</a-descriptions-item>
            <a-descriptions-item label="默认端口">{{ project.defaultPort || '未配置' }}</a-descriptions-item>
          </a-descriptions>
          <a-divider style="margin: 12px 0">命令配置摘要</a-divider>
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="安装命令">{{ project.installCommand || '未配置' }}</a-descriptions-item>
            <a-descriptions-item label="构建命令">{{ project.buildCommand || '未配置' }}</a-descriptions-item>
            <a-descriptions-item label="启动命令">{{ project.startCommand || '未配置' }}</a-descriptions-item>
            <a-descriptions-item label="测试命令">{{ project.testCommand || '未配置' }}</a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-card title="环境状态" style="margin-bottom: 16px;">
          <a-row :gutter="16">
            <a-col :span="8" v-for="env in environments" :key="env.id">
              <a-card size="small" :title="env.name" :style="{ borderTop: `3px solid ${envColor(env.type)}` }">
                <p style="margin: 0; color: #8c8c8c;">类型：{{ env.type }}</p>
                <a-tag :color="env.status === 'active' ? 'green' : 'default'" style="margin-top: 4px;">{{ env.status }}</a-tag>
                <div style="margin-top: 8px;">
                  <a-button v-if="env.type === 'TEST'" size="small" type="primary" @click="showDeploy = true">发布到 Test</a-button>
                  <a-button v-else size="small" disabled>{{ env.type === 'STAGING' ? '预发（后续开放）' : '生产（后续开放）' }}</a-button>
                </div>
              </a-card>
            </a-col>
          </a-row>
          <a-empty v-if="environments.length === 0" description="暂无环境" />
        </a-card>
      </a-col>

      <a-col :span="8">
        <a-card title="环境变量" size="small" style="margin-bottom: 16px;">
          <p style="color: #8c8c8c; margin: 0;">选择左侧环境卡片进入变量管理</p>
        </a-card>
        <a-card title="最近部署" size="small">
          <p style="color: #8c8c8c; margin: 0;">暂无部署记录</p>
        </a-card>
      </a-col>
    </a-row>

    <!-- Deploy dialog -->
    <a-modal v-model:open="showDeploy" title="发布到 Test 环境" @ok="doDeploy" :confirm-loading="deployLoading">
      <a-form layout="vertical">
        <a-form-item label="分支或 Commit">
          <a-input v-model:value="deployForm.branch" placeholder="main 或 commit sha" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="deployForm.notes" placeholder="可选" :rows="2" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchProject, fetchEnvironments, createDeployment } from '../api/client'

const route = useRoute()
const project = ref<any>(null)
const environments = ref<any[]>([])
const showDeploy = ref(false)
const deployLoading = ref(false)
const deployForm = ref({ branch: '', notes: '' })

function envColor(type: string) {
  return type === 'TEST' ? '#1677ff' : type === 'STAGING' ? '#fa8c16' : '#ff4d4f'
}

onMounted(async () => {
  const id = route.params.id as string
  try {
    const [pRes, eRes] = await Promise.all([fetchProject(id), fetchEnvironments(id)])
    project.value = pRes.data
    environments.value = eRes.data
  } catch {}
})

async function doDeploy() {
  deployLoading.value = true
  try {
    const testEnv = environments.value.find((e: any) => e.type === 'TEST')
    if (!testEnv) return
    await createDeployment({
      projectId: project.value.id,
      environmentId: testEnv.id,
      branch: deployForm.value.branch || project.value.defaultBranch,
      notes: deployForm.value.notes,
    })
    showDeploy.value = false
  } catch {}
  deployLoading.value = false
}
</script>
