<template>
  <div style="max-width: 640px;">
    <h2>创建项目</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">填写项目基础信息，创建后自动生成 Test、Staging、Production 三类环境。</p>
    <a-card>
      <a-form :model="form" layout="vertical" @finish="onSubmit">
        <a-form-item label="项目名称" required>
          <a-input v-model:value="form.name" placeholder="例如：my-app" />
        </a-form-item>
        <a-form-item label="项目描述">
          <a-textarea v-model:value="form.description" placeholder="简要描述项目" :rows="2" />
        </a-form-item>
        <a-form-item label="项目类型">
          <a-select v-model:value="form.projectType" placeholder="选择项目模板">
            <a-select-option value="NODE_JS">Node.js</a-select-option>
            <a-select-option value="JAVA_SPRING_BOOT">Java Spring Boot</a-select-option>
            <a-select-option value="PYTHON">Python</a-select-option>
            <a-select-option value="GO">Go</a-select-option>
            <a-select-option value="DOCKERFILE">Dockerfile</a-select-option>
            <a-select-option value="STATIC_SITE">静态站点</a-select-option>
            <a-select-option value="CUSTOM">自定义</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="仓库地址">
          <a-input v-model:value="form.repositoryUrl" placeholder="https://github.com/user/repo" />
        </a-form-item>
        <a-form-item label="默认分支">
          <a-input v-model:value="form.defaultBranch" placeholder="main" />
        </a-form-item>
        <a-form-item label="Git 提供方">
          <a-select v-model:value="form.gitProvider" placeholder="选择">
            <a-select-option value="GITHUB">GitHub</a-select-option>
            <a-select-option value="GITLAB">GitLab</a-select-option>
            <a-select-option value="GENERIC">通用 Git URL</a-select-option>
          </a-select>
        </a-form-item>
        <a-divider>命令配置（可选）</a-divider>
        <a-form-item label="安装命令">
          <a-input v-model:value="form.installCommand" placeholder="npm install" />
        </a-form-item>
        <a-form-item label="构建命令">
          <a-input v-model:value="form.buildCommand" placeholder="npm run build" />
        </a-form-item>
        <a-form-item label="启动命令">
          <a-input v-model:value="form.startCommand" placeholder="npm start" />
        </a-form-item>
        <a-form-item label="测试命令">
          <a-input v-model:value="form.testCommand" placeholder="npm test" />
        </a-form-item>
        <a-form-item label="健康检查路径">
          <a-input v-model:value="form.healthCheckPath" placeholder="/health" />
        </a-form-item>
        <a-form-item label="默认端口">
          <a-input-number v-model:value="form.defaultPort" placeholder="3000" style="width: 100%" />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" html-type="submit" :loading="loading">创建</a-button>
            <a-button @click="$router.back()">取消</a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>
    <a-alert v-if="error" :message="error" type="error" show-icon style="margin-top: 16px" />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createProject } from '../api/client'

const router = useRouter()
const form = reactive({
  name: '', description: '', projectType: null, repositoryUrl: '', defaultBranch: 'main',
  gitProvider: null, installCommand: '', buildCommand: '', startCommand: '', testCommand: '',
  healthCheckPath: '', defaultPort: null as number | null,
})
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  loading.value = true
  error.value = ''
  try {
    const payload: any = { ...form }
    if (payload.defaultPort === null) delete payload.defaultPort
    if (!payload.gitProvider) delete payload.gitProvider
    if (!payload.projectType) delete payload.projectType
    const res = await createProject(payload)
    router.push(`/projects/${res.data.id}`)
  } catch (e: any) {
    error.value = e.response?.data?.message || '创建失败'
  } finally {
    loading.value = false
  }
}
</script>
