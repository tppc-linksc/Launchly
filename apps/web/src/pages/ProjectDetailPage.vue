<template>
  <div v-if="project">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
      <div>
        <h2 style="margin: 0;">{{ project.name }}</h2>
        <p style="color: #8c8c8c; margin: 4px 0 0;">{{ project.description || '暂无描述' }}</p>
      </div>
      <div>
        <el-tag>{{ project.projectType }}</el-tag>
        <el-button v-if="canWrite" style="margin-left: 8px;" @click="openEdit">编辑</el-button>
        <el-button style="margin-left: 8px;" @click="$router.push(`/projects/${project.id}/deploy-targets`)">部署目标</el-button>
        <el-button v-if="canDeploy" type="primary" style="margin-left: 8px;" @click="openDeployFromHeader" :disabled="!project.repositoryUrl">部署</el-button>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="16">
        <el-card header="项目信息" style="margin-bottom: 16px;">
          <el-descriptions :column="2" size="small">
            <el-descriptions-item label="仓库地址">{{ project.repositoryUrl || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="默认分支">{{ project.defaultBranch }}</el-descriptions-item>
            <el-descriptions-item label="Git 提供方">{{ project.gitProvider || '未选择' }}</el-descriptions-item>
            <el-descriptions-item label="健康检查路径">{{ project.healthCheckPath || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="默认端口">{{ project.defaultPort || '未配置' }}</el-descriptions-item>
          </el-descriptions>
          <el-divider>命令配置摘要</el-divider>
          <el-descriptions :column="1" size="small">
            <el-descriptions-item label="安装命令">{{ project.installCommand || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="构建命令">{{ project.buildCommand || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="启动命令">{{ project.startCommand || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="测试命令">{{ project.testCommand || '未配置' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- Workflow Steps -->
        <el-card header="工作流" style="margin-bottom: 16px;">
          <el-steps :active="workflowCurrent" size="small" direction="vertical">
            <el-step title="项目配置" description="配置仓库地址、构建命令、启动命令等基本信息" />
            <el-step title="环境配置" description="配置测试/预发/生产环境的端口、数据策略、环境变量" />
            <el-step title="测试部署" description="选择分支部署到测试环境，自动构建与健康检查" />
            <el-step title="测试任务" description="部署成功后创建测试任务，执行用例并记录结果" />
            <el-step title="Issue 修复" description="对失败用例创建 Issue，指派修复并复测验证" />
            <el-step title="预发发布" description="测试通过后创建 Release，部署到预发环境验证" />
            <el-step title="发布门禁" description="检查预发健康状态、P0 测试通过率等门禁条件" />
            <el-step title="生产发布" description="门禁全部通过后发布到生产环境" />
          </el-steps>
        </el-card>

        <el-card header="环境状态" style="margin-bottom: 16px;">
          <el-row :gutter="16">
            <el-col :span="8" v-for="env in environments" :key="env.id">
              <el-card size="small" :header="env.name" :style="{ borderTop: `3px solid ${envColor(env.type)}` }">
                <p style="margin: 0; color: #8c8c8c;">类型：{{ envTypeMap[env.type] || env.type }}</p>
                <el-tag :type="env.status === 'active' ? 'success' : 'info'" style="margin-top: 4px;">{{ env.status === 'active' ? '活跃' : '未激活' }}</el-tag>
                <div style="margin-top: 8px;">
                  <el-button v-if="canDeploy && (env.type === 'TEST' || env.type === 'STAGING')" size="small" type="primary" @click="openDeploy(env)">部署到此环境</el-button>
                  <el-button v-else-if="!canDeploy && (env.type === 'TEST' || env.type === 'STAGING')" size="small" disabled>无部署权限</el-button>
                  <el-button v-else size="small" disabled>生产（需走 Release）</el-button>
                </div>
              </el-card>
            </el-col>
          </el-row>
          <el-empty v-if="environments.length === 0" description="暂无环境" />
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card header="环境变量" size="small" style="margin-bottom: 16px;">
          <p style="color: #8c8c8c; margin: 0;">前往 <a @click="$router.push(`/environments?projectId=${project.id}`)">环境管理</a> 页面管理变量</p>
        </el-card>
        <el-card header="最近部署" size="small">
          <div v-if="recentDeployments.length === 0" style="color: #8c8c8c;">暂无部署记录</div>
          <div v-for="d in recentDeployments" :key="d.id" style="margin-bottom: 8px; cursor: pointer;" @click="$router.push(`/deployments/${d.id}`)">
            <el-tag :type="deployTagType(d.status)" size="small" style="margin-right: 6px;">{{ deployStatusMap[d.status] || d.status }}</el-tag>
            <span style="font-size: 13px;">{{ d.branch || d.commitSha || '-' }}</span>
            <span style="font-size: 11px; color: #999; float: right;">{{ d.createdAt?.slice(0, 10) }}</span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Deploy dialog -->
    <el-dialog v-model="showDeploy" title="触发部署">
      <el-form label-position="top">
        <el-form-item label="目标环境">
          <el-select v-model="deployForm.environmentId" placeholder="选择环境">
            <el-option v-for="env in deployableEnvs" :key="env.id" :value="env.id" :label="`${env.name} (${envTypeMap[env.type] || env.type})`" />
          </el-select>
        </el-form-item>
        <el-form-item label="部署目标" required>
          <el-select v-model="deployForm.deployTargetId" placeholder="必选：选择已验证的 SSH 部署目标（BYOS）">
            <el-option v-for="t in deployTargets" :key="t.id" :value="t.id" :label="`${t.name} (${t.host})`" />
          </el-select>
          <div style="font-size: 12px; color: #8c8c8c; margin-top: 4px;">
            在云服务器上部署请先在右上角「部署目标」里添加并「测试连接」。环境管理页请保持「本地部署」——表示 Worker 用本机 Docker 构建后再把镜像推到目标机，与「远程」旧选项无关。
          </div>
        </el-form-item>
        <el-form-item label="分支或 Commit">
          <el-input v-model="deployForm.branch" placeholder="main 或 commit sha" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input type="textarea" v-model="deployForm.notes" placeholder="可选" :rows="2" />
        </el-form-item>
      </el-form>
      <el-alert v-if="deployError" :title="deployError" type="error" show-icon style="margin-top: 12px;" />
      <template #footer>
        <el-button @click="showDeploy = false">取消</el-button>
        <el-button type="primary" @click="doDeploy" :loading="deployLoading">确定</el-button>
      </template>
    </el-dialog>

    <!-- Edit Project Modal -->
    <el-dialog v-model="showEdit" title="编辑项目">
      <el-form label-position="top">
        <el-form-item label="项目名称" required>
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="项目描述">
          <el-input type="textarea" v-model="editForm.description" :rows="2" />
        </el-form-item>
        <el-form-item label="仓库地址">
          <el-input v-model="editForm.repositoryUrl" placeholder="https://github.com/user/repo" />
        </el-form-item>
        <el-form-item label="默认分支">
          <el-input v-model="editForm.defaultBranch" />
        </el-form-item>
        <el-form-item label="Git 提供方">
          <el-select v-model="editForm.gitProvider" clearable>
            <el-option value="GITHUB">GitHub</el-option>
            <el-option value="GITLAB">GitLab</el-option>
            <el-option value="GENERIC">通用 Git URL</el-option>
          </el-select>
        </el-form-item>
        <el-divider>命令配置</el-divider>
        <el-form-item label="安装命令">
          <el-input v-model="editForm.installCommand" />
        </el-form-item>
        <el-form-item label="构建命令">
          <el-input v-model="editForm.buildCommand" />
        </el-form-item>
        <el-form-item label="启动命令">
          <el-input v-model="editForm.startCommand" />
        </el-form-item>
        <el-form-item label="测试命令">
          <el-input v-model="editForm.testCommand" />
        </el-form-item>
        <el-form-item label="健康检查路径">
          <el-input v-model="editForm.healthCheckPath" />
        </el-form-item>
        <el-form-item label="默认端口">
          <el-input-number v-model="editForm.defaultPort" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="doEdit" :loading="editLoading">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchProject, updateProject, fetchEnvironments, fetchDeployments, fetchTestRuns, fetchIssues, fetchReleases, createDeployment, fetchDeployTargets } from '../api/client'
import { deployStatusMap, envTypeMap } from '../utils/display'
import { usePermission } from '../composables/usePermission'

const { canDeploy, canWrite } = usePermission()

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
const showEdit = ref(false)
const editLoading = ref(false)
const editForm = reactive({
  name: '', description: '', repositoryUrl: '', defaultBranch: 'main',
  gitProvider: '' as string,
  installCommand: '', buildCommand: '', startCommand: '', testCommand: '',
  healthCheckPath: '', defaultPort: null as number | null,
})

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

function deployTagType(status: string) {
  const map: Record<string, string> = {
    PENDING: 'info', RUNNING: 'primary', SUCCEEDED: 'success',
    FAILED: 'danger', CANCELED: 'warning',
  }
  return map[status] || 'info'
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

function openEdit() {
  const p = project.value
  editForm.name = p.name || ''
  editForm.description = p.description || ''
  editForm.repositoryUrl = p.repositoryUrl || ''
  editForm.defaultBranch = p.defaultBranch || 'main'
  editForm.gitProvider = p.gitProvider || ''
  editForm.installCommand = p.installCommand || ''
  editForm.buildCommand = p.buildCommand || ''
  editForm.startCommand = p.startCommand || ''
  editForm.testCommand = p.testCommand || ''
  editForm.healthCheckPath = p.healthCheckPath || ''
  editForm.defaultPort = p.defaultPort ?? null
  showEdit.value = true
}

async function doEdit() {
  if (!editForm.name.trim()) {
    ElMessage.warning('项目名称不能为空')
    return
  }
  editLoading.value = true
  try {
    await updateProject(project.value.id, { ...editForm })
    const res = await fetchProject(project.value.id)
    project.value = res.data
    showEdit.value = false
    ElMessage.success('项目已更新')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '更新失败')
  }
  editLoading.value = false
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
  } catch (e) { ElMessage.error('操作失败，请稍后重试') }
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
    ElMessage.success('部署已创建')
    router.push(`/deployments/${res.data.id}`)
  } catch (e: any) {
    deployError.value = e.response?.data?.message || '部署创建失败'
  }
  deployLoading.value = false
}
</script>
