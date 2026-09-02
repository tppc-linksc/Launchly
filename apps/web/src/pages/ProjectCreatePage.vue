<template>
  <div class="page">
    <div class="head">
      <div>
        <el-button text @click="router.push('/resources/new')">← 返回资源目录</el-button>
        <h2>配置资源</h2>
        <p v-if="item">{{ item.title }} · {{ item.description }}</p>
      </div>
      <el-tag v-if="item" :type="item.availability === 'DEPLOYABLE' ? 'success' : 'info'">
        {{ item.availability === 'DEPLOYABLE' ? '当前可部署' : '当前仅保存配置' }}
      </el-tag>
    </div>

    <el-alert
      v-if="item?.availability !== 'DEPLOYABLE'"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 18px"
      title="该资源的配置会被安全保存，但当前执行器尚未具备有状态服务、Compose 栈或模板的备份、恢复与升级链路，因此不能触发部署。"
    />

    <el-card v-if="item" class="form-card">
      <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="资源名称" required>
          <el-input v-model="form.name" placeholder="例如：marketing-site、postgres-prod" />
        </el-form-item>
        <el-form-item label="资源描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="说明它服务的业务与用途" />
        </el-form-item>

        <template v-if="usesGit">
          <el-divider>代码来源</el-divider>
          <el-form-item label="仓库地址" required>
            <el-input
              v-model="form.repositoryUrl"
              :placeholder="
                form.sourceType === 'DEPLOY_KEY' ? 'git@github.com:org/repo.git' : 'https://github.com/org/repo.git'
              "
            />
          </el-form-item>
          <el-form-item label="默认分支">
            <el-input v-model="form.defaultBranch" placeholder="main" />
          </el-form-item>
          <el-form-item v-if="form.sourceType === 'GITHUB_APP'" label="GitHub App Installation ID" required>
            <el-input v-model="form.githubInstallationId" placeholder="GitHub App 在此仓库的 installation ID" />
          </el-form-item>
          <el-form-item v-if="form.sourceType === 'GITHUB_APP'" label="GitHub Repository ID" required>
            <el-input v-model="form.githubRepositoryId" placeholder="GitHub 仓库的数字 ID（不是仓库名称）" />
          </el-form-item>
          <template v-if="form.sourceType === 'DEPLOY_KEY'">
            <el-alert
              type="info"
              :closable="false"
              style="margin: 0 0 16px"
              title="私钥仅在提交时通过 TLS 发送，并使用 Launchly 主密钥加密保存；之后不会再返回页面或日志。"
            />
            <el-form-item label="仓库 Deploy Key（私钥）" required>
              <el-input
                v-model="form.repositoryPrivateKey"
                type="textarea"
                :rows="5"
                autocomplete="off"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </el-form-item>
            <el-form-item label="仓库 SSH Host Key" required>
              <el-input v-model="form.repositoryHostKey" placeholder="ssh-ed25519 AAAA..." />
            </el-form-item>
          </template>
        </template>

        <template v-if="form.sourceType === 'OCI_IMAGE'">
          <el-divider>镜像来源</el-divider>
          <el-form-item label="不可变 OCI 镜像引用" required>
            <el-input v-model="form.imageReference" placeholder="ghcr.io/acme/app@sha256:..." />
            <div class="hint">只接受 digest，不接受 latest 或普通 tag。部署节点仅拉取这一份制品。</div>
          </el-form-item>
        </template>

        <el-divider>运行拓扑</el-divider>
        <el-form-item label="方案">
          <el-radio-group v-model="form.topology">
            <el-radio value="SINGLE_SERVICE">单个应用</el-radio>
            <el-radio value="SEPARATE_DATABASE">应用与独立数据库</el-radio>
            <el-radio value="DISTRIBUTED">多服务 / 分布式</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-alert
          v-if="form.topology !== 'SINGLE_SERVICE' && item.availability === 'DEPLOYABLE'"
          type="info"
          :closable="false"
          style="margin-bottom: 18px"
          title="此处会记录资源拓扑；当前单应用执行器不会自动创建附属数据库或服务。请先把数据库作为独立资源管理。"
        />

        <template v-if="item.availability === 'DEPLOYABLE' && form.sourceType !== 'OCI_IMAGE'">
          <el-divider>构建与运行</el-divider>
          <el-form-item label="OCI Registry 仓库" required>
            <el-input v-model="form.registryRepository" placeholder="ghcr.io/org/my-app" />
            <div class="hint">构建将推送 commit SHA 与 deployment ID 组成的不可变 tag。</div>
          </el-form-item>
          <el-form-item label="安装命令"><el-input v-model="form.installCommand" placeholder="npm ci" /></el-form-item>
          <el-form-item label="构建命令"
            ><el-input v-model="form.buildCommand" placeholder="npm run build"
          /></el-form-item>
          <el-form-item label="启动命令"><el-input v-model="form.startCommand" placeholder="npm start" /></el-form-item>
          <el-form-item label="测试命令"><el-input v-model="form.testCommand" placeholder="npm test" /></el-form-item>
        </template>

        <template v-if="item.availability === 'DEPLOYABLE'">
          <el-divider>健康检查</el-divider>
          <el-form-item label="健康检查路径"
            ><el-input v-model="form.healthCheckPath" placeholder="/health"
          /></el-form-item>
          <el-form-item label="容器端口"
            ><el-input-number v-model="form.defaultPort" :min="1" :max="65535" style="width: 100%"
          /></el-form-item>
        </template>

        <el-form-item>
          <el-space>
            <el-button type="primary" native-type="submit" :loading="loading">保存资源</el-button>
            <el-button @click="router.push('/resources/new')">取消</el-button>
          </el-space>
        </el-form-item>
      </el-form>
    </el-card>
    <el-empty v-else-if="!catalogLoading" description="资源类型不存在或已下线"
      ><el-button type="primary" @click="router.push('/resources/new')">返回资源目录</el-button></el-empty
    >
    <el-alert v-if="error" :title="error" type="error" show-icon style="margin-top: 16px" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createProject, fetchResourceCatalog } from '../api/client';

const router = useRouter();
const route = useRoute();
const catalogLoading = ref(false);
const catalog = ref<any[]>([]);
const item = computed(() => catalog.value.find((entry) => entry.id === route.query.resource));
const usesGit = computed(() => ['GIT_PUBLIC', 'GITHUB_APP', 'DEPLOY_KEY'].includes(form.sourceType));
const loading = ref(false);
const error = ref('');
const form = reactive({
  name: '',
  description: '',
  projectType: 'CUSTOM',
  resourceKind: 'APPLICATION',
  sourceType: 'GIT_PUBLIC',
  runtimeMode: 'BUILDKIT',
  templateId: '',
  repositoryUrl: '',
  defaultBranch: 'main',
  gitProvider: 'GITHUB',
  githubInstallationId: '',
  githubRepositoryId: '',
  registryRepository: '',
  imageReference: '',
  installCommand: '',
  buildCommand: '',
  startCommand: '',
  testCommand: '',
  healthCheckPath: '/health',
  defaultPort: 3000,
  topology: 'SINGLE_SERVICE',
  repositoryPrivateKey: '',
  repositoryHostKey: '',
});

function applyItem(value: any) {
  if (!value) return;
  form.projectType = value.projectType;
  form.resourceKind = value.resourceKind;
  form.sourceType = value.sourceType;
  form.runtimeMode = value.runtimeMode;
  form.templateId = value.templateId || '';
  if (value.projectType === 'STATIC_SITE') {
    form.installCommand = 'npm ci';
    form.buildCommand = 'npm run build';
    form.startCommand = 'npm start';
    if (value.templateId === 'static-blog') form.defaultPort = 80;
  }
}
watch(item, applyItem, { immediate: true });

async function onSubmit() {
  if (!form.name.trim()) {
    error.value = '请填写资源名称';
    return;
  }
  if (usesGit.value && !form.repositoryUrl.trim()) {
    error.value = '请填写仓库地址';
    return;
  }
  if (form.sourceType === 'OCI_IMAGE' && !form.imageReference.includes('@sha256:')) {
    error.value = 'OCI 镜像必须使用 @sha256: digest';
    return;
  }
  if (
    form.sourceType === 'GITHUB_APP' &&
    (!/^\d+$/.test(form.githubInstallationId.trim()) || !/^\d+$/.test(form.githubRepositoryId.trim()))
  ) {
    error.value = '请填写数字格式的 GitHub App Installation ID 和 Repository ID';
    return;
  }
  if (form.sourceType === 'DEPLOY_KEY' && (!form.repositoryPrivateKey.trim() || !form.repositoryHostKey.trim())) {
    error.value = 'Deploy Key 与仓库 Host Key 都是必填项';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const payload: any = { ...form, resourceConfig: { topology: form.topology } };
    delete payload.topology;
    delete payload.repositoryPrivateKey;
    delete payload.repositoryHostKey;
    if (!payload.templateId) delete payload.templateId;
    if (!payload.githubInstallationId) delete payload.githubInstallationId;
    if (!payload.githubRepositoryId) delete payload.githubRepositoryId;
    if (!payload.repositoryUrl) delete payload.repositoryUrl;
    if (!payload.registryRepository) delete payload.registryRepository;
    if (!payload.imageReference) delete payload.imageReference;
    if (form.sourceType === 'DEPLOY_KEY')
      payload.repositoryCredential = { privateKey: form.repositoryPrivateKey, hostKey: form.repositoryHostKey };
    const res = await createProject(payload);
    router.push(`/projects/${res.data.id}`);
  } catch (e: any) {
    error.value = e.response?.data?.message || '保存失败';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  catalogLoading.value = true;
  try {
    catalog.value = (await fetchResourceCatalog()).data || [];
    applyItem(item.value);
  } catch {
    error.value = '无法加载资源目录';
  } finally {
    catalogLoading.value = false;
  }
});
</script>

<style scoped>
.page {
  max-width: 760px;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
}
.head h2 {
  margin: 6px 0 0;
}
.head p {
  color: #6b7280;
  margin: 6px 0 0;
}
.form-card {
  border-radius: 12px;
}
.hint {
  color: #909399;
  font-size: 12px;
  margin-top: 6px;
  line-height: 1.4;
}
@media (max-width: 700px) {
  .head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
