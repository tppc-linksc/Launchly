<template>
  <div style="max-width: 640px;">
    <h2>创建项目</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">填写项目基础信息，创建后自动生成 Test、Staging、Production 三类环境。</p>
    <el-card>
      <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="项目名称" required>
          <el-input v-model="form.name" placeholder="例如：my-app" />
        </el-form-item>
        <el-form-item label="项目描述">
          <el-input type="textarea" v-model="form.description" placeholder="简要描述项目" :rows="2" />
        </el-form-item>
        <el-form-item label="项目类型">
          <el-select v-model="form.projectType" placeholder="选择项目模板">
            <el-option value="NODE_JS">Node.js</el-option>
            <el-option value="JAVA_SPRING_BOOT">Java Spring Boot</el-option>
            <el-option value="PYTHON">Python</el-option>
            <el-option value="GO">Go</el-option>
            <el-option value="DOCKERFILE">Dockerfile</el-option>
            <el-option value="STATIC_SITE">静态站点</el-option>
            <el-option value="CUSTOM">自定义</el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="仓库地址">
          <el-input v-model="form.repositoryUrl" placeholder="https://github.com/user/repo" />
        </el-form-item>
        <el-form-item label="默认分支">
          <el-input v-model="form.defaultBranch" placeholder="main" />
        </el-form-item>
        <el-form-item label="Git 提供方">
          <el-select v-model="form.gitProvider" placeholder="选择">
            <el-option value="GITHUB">GitHub</el-option>
            <el-option value="GITLAB">GitLab</el-option>
            <el-option value="GENERIC">通用 Git URL</el-option>
          </el-select>
        </el-form-item>
        <el-divider>命令配置（可选）</el-divider>
        <el-form-item label="安装命令">
          <el-input v-model="form.installCommand" placeholder="npm install" />
        </el-form-item>
        <el-form-item label="构建命令">
          <el-input v-model="form.buildCommand" placeholder="npm run build" />
        </el-form-item>
        <el-form-item label="启动命令">
          <el-input v-model="form.startCommand" placeholder="npm start" />
        </el-form-item>
        <el-form-item label="测试命令">
          <el-input v-model="form.testCommand" placeholder="npm test" />
        </el-form-item>
        <el-form-item label="健康检查路径">
          <el-input v-model="form.healthCheckPath" placeholder="/health" />
        </el-form-item>
        <el-form-item label="默认端口">
          <el-input-number v-model="form.defaultPort" placeholder="3000" style="width: 100%" />
        </el-form-item>
        <el-form-item>
          <el-space>
            <el-button type="primary" native-type="submit" :loading="loading">创建</el-button>
            <el-button @click="$router.back()">取消</el-button>
          </el-space>
        </el-form-item>
      </el-form>
    </el-card>
    <el-alert v-if="error" :title="error" type="error" show-icon style="margin-top: 16px" />
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
