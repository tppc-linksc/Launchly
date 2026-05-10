<template>
  <div>
    <h2>Environments</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">管理 Test、Staging、Production 环境配置与环境变量。</p>
    <a-table :columns="columns" :data-source="envs" row-key="id" :loading="loading">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <a-tag :color="record.type === 'TEST' ? 'blue' : record.type === 'STAGING' ? 'orange' : 'red'">{{ record.type }}</a-tag>
        </template>
        <template v-if="column.key === 'status'">
          <a-badge :status="record.status === 'active' ? 'success' : 'default'" :text="record.status" />
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" @click="selectedEnv = record">查看变量</a-button>
        </template>
      </template>
    </a-table>

    <a-modal :open="selectedEnvOpen" :title="'环境变量 — ' + (selectedEnv?.name || '')" width="640px" @cancel="selectedEnv = null">
      <a-table :columns="varColumns" :data-source="variables" row-key="id" size="small" :pagination="false">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'value'">
            <code>{{ record.maskedValue }}</code>
            <a-tag v-if="record.sensitive" color="warning" style="margin-left: 4px;">敏感</a-tag>
          </template>
          <template v-if="column.key === 'action'">
            <a-popconfirm title="确定删除此变量？" @confirm="doDeleteVar(record.id)">
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
      <a-divider />
      <a-form :model="newVar" layout="inline" @finish="addVar">
        <a-form-item><a-input v-model:value="newVar.key" placeholder="KEY" style="width: 150px" /></a-form-item>
        <a-form-item><a-input v-model:value="newVar.value" placeholder="VALUE" style="width: 200px" /></a-form-item>
        <a-form-item><a-switch v-model:checked="newVar.sensitive" checked-children="敏感" un-checked-children="普通" /></a-form-item>
        <a-form-item><a-button type="primary" html-type="submit" :loading="adding">添加</a-button></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, reactive } from 'vue'
import { fetchProjects, fetchEnvironments, fetchEnvVariables, createEnvVariable, deleteEnvVariable } from '../api/client'

const columns = [
  { title: '环境名称', dataIndex: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: 'URL', dataIndex: 'url' },
  { title: '操作', key: 'action' },
]

const varColumns = [
  { title: 'Key', dataIndex: 'key' },
  { title: 'Value', key: 'value' },
  { title: '操作', key: 'action', width: 80 },
]

const envs = ref<any[]>([])
const loading = ref(false)
const selectedEnv = ref<any>(null)
const selectedEnvOpen = computed(() => !!selectedEnv.value)
const variables = ref<any[]>([])
const newVar = reactive({ key: '', value: '', sensitive: false })
const adding = ref(false)

watch(selectedEnv, async (env) => {
  if (!env) return
  try {
    const res = await fetchEnvVariables(env.id)
    variables.value = res.data
  } catch {}
})

async function addVar() {
  if (!selectedEnv.value || !newVar.key || !newVar.value) return
  adding.value = true
  try {
    await createEnvVariable(selectedEnv.value.id, {
      key: newVar.key,
      value: newVar.value,
      sensitive: newVar.sensitive,
    })
    newVar.key = ''; newVar.value = ''; newVar.sensitive = false
    const res = await fetchEnvVariables(selectedEnv.value.id)
    variables.value = res.data
  } catch {}
  adding.value = false
}

async function doDeleteVar(id: string) {
  if (!selectedEnv.value) return
  await deleteEnvVariable(selectedEnv.value.id, id)
  variables.value = variables.value.filter((v: any) => v.id !== id)
}

// Load all envs from all projects
async function loadEnvs() {
  loading.value = true
  try {
    const projectsRes = await fetchProjects()
    const allEnvs: any[] = []
    for (const p of projectsRes.data) {
      try {
        const eRes = await fetchEnvironments(p.id)
        allEnvs.push(...eRes.data)
      } catch {}
    }
    envs.value = allEnvs
  } catch {}
  loading.value = false
}

loadEnvs()
</script>
