<template>
  <div v-if="project">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
      <div>
        <h2 style="margin: 0;">{{ project.name }}</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">{{ project.description || '暂无描述' }}</p>
      </div>
      <div>
        <a-tag>{{ project.projectType }}</a-tag>
        <a-button style="margin-left: 8px;" @click="$router.push(`/projects/${project.id}/deploy-targets`)">部署目标</a-button>
        <a-button type="primary" style="margin-left: 8px;" @click="openDeployFromHeader" :disabled="!project.repositoryUrl">部署</a-button>
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

        <!-- Workflow Steps -->
        <a-card title="工作流" style="margin-bottom: 16px;">
          <a-steps :current="workflowCurrent" size="small" direction="vertical">
            <a-step title="项目配置" description="配置仓库地址、构建命令、启动命令等基本信息" />
            <a-step title="环境配置" description="配置测试/预发/生产环境的端口、数据策略、环境变量" />
            <a-step title="测试部署" description="选择分支部署到测试环境，自动构建与健康检查" />
            <a-step title="测试任务" description="部署成功后创建测试任务，执行用例并记录结果" />
            <a-step title="Issue 修复" description="对失败用例创建 Issue，指派修复并复测验证" />
            <a-step title="预发发布" description="测试通过后创建 Release，部署到预发环境验证" />
            <a-step title="发布门禁" description="检查预发健康状态、P0 测试通过率等门禁条件" />
            <a-step title="生产发布" description="门禁全部通过后发布到生产环境" />
          </a-steps>
        </a-card>

        <a-card title="环境状态" style="margin-bottom: 16px;">
          <a-row :gutter="16">
            <a-col :span="8" v-for="env in environments" :key="env.id">
              <a-card size="small" :title="env.name" :style="{ borderTop: `3px solid ${envColor(env.type)}` }">
                <p style="margin: 0; color: #8c8c8c;">类型：{{ envTypeMap[env.type] || env.type }}</p>
                <a-tag :color="env.status === 'active' ? 'green' : 'default'" style="margin-top: 4px;">{{ env.status === 'active' ? '活跃' : '未激活' }}</a-tag>
                <div style="margin-top: 8px;">
                  <a-button v-if="env.type === 'TEST' || env.type === 'STAGING'" size="small" type="primary" @click="openDeploy(env)">部署到此环境</a-button>
                  <a-button v-else size="small" disabled>生产（需走 Release）</a-button>
                </div>
              </a-card>
            </a-col>
          </a-row>
          <a-empty v-if="environments.length === 0" description="暂无环境" />
        </a-card>
      </a-col>

      <a-col :span="8">
        <a-card title="环境变量" size="small" style="margin-bottom: 16px;">
          <p style="color: #8c8c8c; margin: 0;">前往 <a @click="$router.push('/environments')">环境管理</a> 页面管理变量</p>
        </a-card>
        <a-card title="最近部署" size="small">
          <div v-if="recentDeployments.length === 0" style="color: #8c8c8c;">暂无部署记录</div>
          <div v-for="d in recentDeployments" :key="d.id" style="margin-bottom: 8px; cursor: pointer;" @click="$router.push(`/deployments/${d.id}`)">
            <a-tag :color="d.status === 'SUCCEEDED' ? 'green' : d.status === 'FAILED' ? 'red' : d.status === 'RUNNING' ? 'processing' : 'default'" size="small" style="margin-right: 6px;">{{ deployStatusMap[d.status] || d.status }}</a-tag>
            <span style="font-size: 13px;">{{ d.branch || d.commitSha || '-' }}</span>
            <span style="font-size: 11px; color: #999; float: right;">{{ d.createdAt?.slice(0, 10) }}</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Deploy dialog -->
    <a-modal v-model:open="showDeploy" title="触发部署" @ok="doDeploy" :confirm-loading="deployLoading">
      <a-form layout="vertical">
        <a-form-item label="目标环境">
          <a-select v-model:value="deployForm.environmentId" placeholder="选择环境">
            <a-select-option v-for="env in deployableEnvs" :key="env.id" :value="env.id">
              {{ env.name }} ({{ envTypeMap[env.type] || env.type }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="部署目标" required>
          <a-select v-model:value="deployForm.deployTargetId" placeholder="必选：选择已验证的 SSH 部署目标（BYOS）">
            <a-select-option v-for="t in deployTargets" :key="t.id" :value="t.id">
              {{ t.name }} ({{ t.host }})
            </a-select-option>
          </a-select>
          <div style="font-size: 12px; color: #8c8c8c; margin-top: 4px;">
            在云服务器上部署请先在右上角「部署目标」里添加并「测试连接」。环境管理页请保持「本地部署」——表示 Worker 用本机 Docker 构建后再把镜像推到目标机，与「远程」旧选项无关。
          </div>
        </a-form-item>
        <a-form-item label="分支或 Commit">
          <a-input v-model:value="deployForm.branch" placeholder="main 或 commit sha" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="deployForm.notes" placeholder="可选" :rows="2" />
        </a-form-item>
      </a-form>
      <a-alert v-if="deployError" :message="deployError" type="error" show-icon style="margin-top: 12px;" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { fetchProject, fetchEnvironments, fetchDeployments, fetchTestRuns, fetchIssues, fetchReleases, createDeployment, fetchDeployTargets } from '../api/client'
import { deployStatusMap, envTypeMap } from '../utils/display'

const route = useRoute()
const router = useRouter()
const project = ref<any>(null)
const environments = ref<any[]>([])
const recentDeployments = ref<any[]>([])
const testRuns = ref<any[]>([])
const issues = ref<any[]>([])
const releases = ref<any[]>([])
const showDeploy = ref(false)
const deployLoading = ref(false)
const deployError = ref('')
const deployTargets = ref<any[]>([])
const deployForm = ref({ environmentId: '', deployTargetId: '', branch: '', notes: '' })

const deployableEnvs = computed(() =>
  environments.value.filter((e: any) => e.type === 'TEST' || e.type === 'STAGING')
)

const workflowCurrent = computed(() => {
  if (!project.value) return 0
  if (environments.value.length === 0) return 1
  if (recentDeployments.value.length === 0) return 2
  const hasSuccess = recentDeployments.value.some((d: any) => d.status === 'SUCCEEDED')
  if (!hasSuccess) return 2
  if (testRuns.value.length === 0) return 3
  const allTestsDone = testRuns.value.every((t: any) => t.status === 'COMPLETED')
  if (!allTestsDone) return 3
  if (issues.value.length === 0) return 4
  if (releases.value.length === 0) return 5
  const hasReadyRelease = releases.value.some((r: any) => r.status === 'READY')
  if (!hasReadyRelease) return 6
  const hasPublished = releases.value.some((r: any) => r.status === 'PUBLISHED')
  if (!hasPublished) return 6
  return 7
})

function envColor(type: string) {
  return type === 'TEST' ? '#1677ff' : type === 'STAGING' ? '#fa8c16' : '#ff4d4f'
}

function openDeploy(env: any) {
  deployForm.value.environmentId = env.id
  deployForm.value.deployTargetId = ''
  deployForm.value.branch = ''
  deployForm.value.notes = ''
  deployError.value = ''
  showDeploy.value = true
}

/** 顶部「部署」：若只有一个可部署环境则预选，避免只填目标却未选环境 */
function openDeployFromHeader() {
  deployForm.value.deployTargetId = ''
  deployForm.value.branch = ''
  deployForm.value.notes = ''
  deployError.value = ''
  const list = deployableEnvs.value
  deployForm.value.environmentId = list.length === 1 ? list[0].id : ''
  showDeploy.value = true
}

onMounted(async () => {
  const id = route.params.id as string
  try {
    const [pRes, eRes, dRes, tRes, iRes, rRes, dtRes] = await Promise.all([
      fetchProject(id),
      fetchEnvironments(id),
      fetchDeployments({ projectId: id }),
      fetchTestRuns(id),
      fetchIssues(id),
      fetchReleases(id),
      fetchDeployTargets(id),
    ])
    project.value = pRes.data
    environments.value = eRes.data
    recentDeployments.value = (dRes.data || []).slice(0, 5)
    testRuns.value = tRes.data || []
    issues.value = iRes.data || []
    releases.value = rRes.data || []
    deployTargets.value = dtRes.data || []
  } catch {}
})

async function doDeploy() {
  deployLoading.value = true
  deployError.value = ''
  try {
    const envId = deployForm.value.environmentId
    const targetEnv = environments.value.find((e: any) => e.id === envId)
    if (!targetEnv) {
      deployError.value = '请选择目标环境'
      deployLoading.value = false
      return
    }
    if (!deployForm.value.deployTargetId) {
      deployError.value = '请选择部署目标（BYOS）。请先在「部署目标」页面添加并验证连接。'
      deployLoading.value = false
      return
    }
    const res = await createDeployment({
      projectId: project.value.id,
      environmentId: envId,
      deployTargetId: deployForm.value.deployTargetId,
      branch: deployForm.value.branch || project.value.defaultBranch,
      notes: deployForm.value.notes,
    })
    showDeploy.value = false
    deployForm.value = { environmentId: '', deployTargetId: '', branch: '', notes: '' }
    message.success('部署已创建')
    router.push(`/deployments/${res.data.id}`)
  } catch (e: any) {
    deployError.value = e.response?.data?.message || '部署创建失败'
  }
  deployLoading.value = false
}
</script>
