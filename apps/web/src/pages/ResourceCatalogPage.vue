<template>
  <div>
    <div class="page-head">
      <div>
        <h2>新建资源</h2>
        <p>从代码、镜像、数据库、服务栈或模板开始。每张卡片明确标注当前是否已有安全发布执行器。</p>
      </div>
      <el-input v-model="query" clearable placeholder="搜索资源或模板" class="search" />
    </div>
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 20px">
      <template #title>应用资源可以选择公开 Git、GitHub App、Deploy Key 或不可变 OCI 镜像；有状态数据库和一键模板会先保存受控配置，待其备份、恢复和升级执行器完成后才允许发布。</template>
    </el-alert>
    <div v-loading="loading">
      <section v-for="section in sections" :key="section.key" class="section">
        <h3>{{ section.title }}</h3>
        <div class="catalog-grid">
          <button v-for="item in itemsByCategory(section.key)" :key="item.id" class="resource-card" @click="select(item)">
            <div class="card-top">
              <div class="resource-icon">{{ icon(item) }}</div>
              <el-tag size="small" :type="item.availability === 'DEPLOYABLE' ? 'success' : 'info'">
                {{ item.availability === 'DEPLOYABLE' ? '可部署' : '仅配置' }}
              </el-tag>
            </div>
            <strong>{{ item.title }}</strong>
            <span>{{ item.description }}</span>
            <small v-if="item.requirements?.length">{{ item.requirements.join(' · ') }}</small>
          </button>
        </div>
      </section>
    </div>
    <el-empty v-if="!loading && filtered.length === 0" description="没有匹配的资源" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchResourceCatalog } from '../api/client'

const router = useRouter()
const loading = ref(false)
const query = ref('')
const items = ref<any[]>([])
const sections = [
  { key: 'APPLICATION', title: '应用与交付来源' },
  { key: 'DATABASE', title: '数据库' },
  { key: 'CACHE', title: '缓存与队列' },
  { key: 'TEMPLATE', title: '一键模板' },
]
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? items.value.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(needle)) : items.value
})
function itemsByCategory(category: string) { return filtered.value.filter(item => item.category === category) }
function select(item: any) { router.push({ path: '/projects/create', query: { resource: item.id } }) }
function icon(item: any) {
  if (item.category === 'DATABASE') return 'DB'
  if (item.category === 'CACHE') return '◎'
  if (item.category === 'TEMPLATE') return '✦'
  if (item.sourceType === 'OCI_IMAGE') return 'OCI'
  if (item.runtimeMode === 'COMPOSE') return '≋'
  return '↗'
}
onMounted(async () => {
  loading.value = true
  try { items.value = (await fetchResourceCatalog()).data || [] } finally { loading.value = false }
})
</script>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 20px; }
h2 { margin: 0; color: #111827; } .page-head p { color: #6b7280; margin: 8px 0 0; } .search { width: 280px; }
.section { margin: 28px 0; } .section h3 { margin: 0 0 12px; color: #374151; font-size: 16px; }
.catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px; }
.resource-card { text-align: left; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; padding: 16px; cursor: pointer; min-height: 156px; display: flex; flex-direction: column; gap: 8px; transition: .15s ease; color: inherit; }
.resource-card:hover { border-color: #0d9488; box-shadow: 0 4px 14px rgba(13,148,136,.12); transform: translateY(-1px); }
.card-top { display: flex; justify-content: space-between; align-items: center; } .resource-icon { color: #0f766e; background: #ecfdf5; border-radius: 8px; padding: 6px 8px; font-size: 12px; font-weight: 700; }
.resource-card strong { color: #111827; } .resource-card span { font-size: 13px; line-height: 1.45; color: #6b7280; flex: 1; } .resource-card small { font-size: 11px; color: #9ca3af; }
@media (max-width: 700px) { .page-head { align-items: stretch; flex-direction: column; } .search { width: 100%; } }
</style>
