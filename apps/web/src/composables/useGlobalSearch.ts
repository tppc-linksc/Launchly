/**
 * KI-014 全局搜索组合式逻辑
 *
 * 搜索维度：项目 / 服务（项目下资源）/ 部署记录 / 部署目标（节点）
 *          以及它们的派生信息：分支、commit、域名（暂用 repositoryUrl 代替）。
 *
 * 设计要点：
 * 1. 单一入口 search(query) 会并发拉取所有数据源，并把结果合并到统一的
 *    SearchResult 列表里，每个结果带 category 标记来源类别。
 * 2. 客户端再做一次统一过滤（标题、ID、来源 URL、分支、commit、节点名等），
 *    避免对每个 API 单独拼 query 字符串。
 * 3. 单条数据加载失败不影响其他类别的结果；其它来源仍可命中。
 * 4. 不修改任何后端接口；只消费已存在的 fetchProjects / fetchDeployments
 *    / fetchAllDeployTargets。
 *
 * SearchResult 形状：
 *   {
 *     id: string,                 // 跳转目标的唯一 ID
 *     category: ResultCategory,  // 类别（用于彩色 chip 区分）
 *     title: string,              // 主标题（项目名 / 部署 ID / 节点名 等）
 *     subtitle?: string,          // 副标题（构建计划 / 状态 / 仓库地址 等）
 *     keywords: string[],         // 用于匹配 query 的多个关键词字段
 *     path: string,               // 跳转目标路由（router.push 使用）
 *   }
 *
 * 这种设计让调用方（AppLayout）只关心一件事：输入变化 → 渲染结果 → 点击跳转。
 */

import { computed, ref, watch } from 'vue'
import {
  fetchProjects,
  fetchDeployments,
  fetchAllDeployTargets,
} from '../api/client'

export type ResultCategory =
  | 'project'      // 项目 / 应用
  | 'service'      // 项目下的服务（暂以项目的 resourceKind 派生）
  | 'deployment'   // 部署记录（按部署 ID / commit / 分支匹配）
  | 'node'         // 部署目标 / 节点 / SSH 主机
  | 'branch'       // 分支（从项目的部署历史中提取）
  | 'commit'       // commit（从部署记录中提取）
  | 'domain'       // 域名 / 仓库地址（仓库地址 = 域名）

export interface SearchResult {
  id: string
  category: ResultCategory
  title: string
  subtitle?: string
  keywords: string[]
  path: string
}

interface ProjectRecord {
  id: string
  name: string
  description?: string
  projectType?: string
  resourceKind?: string
  repositoryUrl?: string
  defaultBranch?: string
  [k: string]: any
}

interface DeploymentRecord {
  id: string
  projectId?: string
  projectName?: string
  status?: string
  branch?: string
  commitSha?: string
  environmentName?: string
  [k: string]: any
}

interface DeployTargetRecord {
  id: string
  name: string
  projectId?: string
  projectName?: string
  host?: string
  port?: number
  username?: string
  type?: string
  [k: string]: any
}

// 安全地把任意值转成可匹配的字符串数组；值为 null/undefined 会跳过。
function asKeywords(...values: any[]): string[] {
  return values
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(v => String(v).toLowerCase())
}

// 把项目派生出 "服务 / 分支 / 域名" 三类结果。
// 项目本身可以以"服务"视角展示（资源类型 + 仓库），分支从 defaultBranch 派生，
// 域名从 repositoryUrl 派生（RepositoryUrl 等同 git 域名）。
function expandProject(p: ProjectRecord): SearchResult[] {
  const out: SearchResult[] = []

  // 1) 项目本体
  out.push({
    id: p.id,
    category: 'project',
    title: p.name,
    subtitle: (p.projectType || '资源') + ' · ' + (p.description || '暂无描述'),
    keywords: asKeywords(p.id, p.name, p.description, p.projectType, p.resourceKind),
    path: '/projects/' + p.id,
  })

  // 2) 服务（同一资源的另一视角）
  if (p.resourceKind) {
    out.push({
      id: p.id + '::service',
      category: 'service',
      title: p.name + ' 服务',
      subtitle: p.resourceKind + ' 类型资源',
      keywords: asKeywords(p.name, p.resourceKind, p.description, p.projectType),
      path: '/projects/' + p.id,
    })
  }

  // 3) 分支（从项目默认分支派生）
  if (p.defaultBranch) {
    out.push({
      id: p.id + '::branch',
      category: 'branch',
      title: p.defaultBranch,
      subtitle: p.name + ' 的默认分支',
      keywords: asKeywords(p.defaultBranch, p.name, p.id),
      path: '/projects/' + p.id,
    })
  }

  // 4) 域名（仓库地址作为产物入口；可视作访问入口）
  if (p.repositoryUrl) {
    out.push({
      id: p.id + '::domain',
      category: 'domain',
      title: p.repositoryUrl,
      subtitle: p.name + ' 的仓库地址',
      keywords: asKeywords(p.repositoryUrl, p.name, p.id),
      path: '/projects/' + p.id,
    })
  }

  return out
}

// 从部署记录里同时抽出 commit / branch / 部署 ID 三类结果。
function expandDeployment(d: DeploymentRecord): SearchResult[] {
  const out: SearchResult[] = []
  out.push({
    id: d.id,
    category: 'deployment',
    title: '部署 ' + d.id,
    subtitle: (d.projectName || d.projectId || '未知项目') + ' · ' + (d.status || ''),
    keywords: asKeywords(d.id, d.projectName, d.projectId, d.status, d.environmentName),
    path: '/deployments/' + d.id,
  })

  // commit 维度：每个 commit SHA 都能跳转回对应部署详情
  if (d.commitSha) {
    out.push({
      id: d.id + '::commit',
      category: 'commit',
      title: d.commitSha,
      subtitle: (d.projectName || d.projectId || '项目') + ' 的部署 commit',
      keywords: asKeywords(d.commitSha, d.projectName, d.projectId, d.id),
      path: '/deployments/' + d.id,
    })
  }

  // 部署使用的分支（和项目默认分支不同，可能是特性分支）
  if (d.branch && d.branch !== '') {
    out.push({
      id: d.id + '::branch',
      category: 'branch',
      title: d.branch,
      subtitle: (d.projectName || d.projectId || '项目') + ' 上的一次部署',
      keywords: asKeywords(d.branch, d.projectName, d.projectId, d.id),
      path: '/deployments/' + d.id,
    })
  }

  return out
}

// 把节点 / 部署目标派生为独立类别。
function expandTarget(t: DeployTargetRecord): SearchResult[] {
  const sub = ((t.host || '') + (t.port ? ':' + t.port : '') + (t.username ? '(' + t.username + ')' : '')).trim()
  return [{
    id: t.id,
    category: 'node',
    title: t.name,
    subtitle: sub,
    keywords: asKeywords(t.id, t.name, t.host, t.username, t.projectName, t.projectId, t.type),
    path: '/deploy-targets',
  }]
}

// 客户端关键词过滤：忽略 query 大小写，检查每个结果的 keywords 数组是否包含
// 任一关键字子串。空 query 不返回结果（搜索是用户主动触发的）。
function filterResults(results: SearchResult[], query: string): SearchResult[] {
  if (!query.trim()) return []
  const q = query.trim().toLowerCase()
  return results.filter(r => r.keywords.some(k => k.includes(q)))
}

export interface UseGlobalSearchOptions {
  // 最大返回结果数；超出后按类别截断
  maxResults?: number
  // 防抖时长（毫秒）
  debounceMs?: number
}

// 全局搜索的主组合式。
//
// 用法：
//   const { query, results, loading, error, refresh } = useGlobalSearch()
//   <input v-model="query" />
//   <li v-for="r in results" :key="r.id">{{ r.title }}</li>
//   // 跳转：router.push(r.path)
export function useGlobalSearch(options: UseGlobalSearchOptions = {}) {
  const maxResults = options.maxResults ?? 30
  const debounceMs = options.debounceMs ?? 200

  const query = ref('')
  const raw = ref<SearchResult[]>([])
  const loading = ref(false)
  const error = ref('')

  let debounceHandle: ReturnType<typeof setTimeout> | null = null
  let lastFetchId = 0

  // 拉取所有数据源；任一失败都会被吞掉（其它数据源仍可命中）。
  async function loadAll(): Promise<SearchResult[]> {
    const fetchId = ++lastFetchId
    const safe = async (p: Promise<any>): Promise<any> => {
      try { return (await p).data } catch { return null }
    }
    const [projects, deployments, targets] = await Promise.all([
      safe(fetchProjects()),
      safe(fetchDeployments()),
      safe(fetchAllDeployTargets()),
    ])
    // 防止慢请求覆盖快请求带来的脏状态
    if (fetchId !== lastFetchId) return []

    const results: SearchResult[] = []
    for (const p of (projects || [])) results.push(...expandProject(p))
    for (const d of (deployments || [])) results.push(...expandDeployment(d))
    for (const t of (targets || [])) results.push(...expandTarget(t))
    return results
  }

  // 立即触发一次刷新：拉取数据并重新计算结果。
  async function refresh(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      raw.value = await loadAll()
    } catch (e: any) {
      error.value = (e && e.message) || '搜索失败'
    } finally {
      loading.value = false
    }
  }

  // 触发一次刷新（带防抖）。每次 query 变化都会重置防抖。
  function scheduleRefresh() {
    if (debounceHandle) clearTimeout(debounceHandle)
    debounceHandle = setTimeout(() => { refresh() }, debounceMs)
  }

  // 对外可消费的过滤后结果
  const results = computed<SearchResult[]>(() => {
    const filtered = filterResults(raw.value, query.value)
    // 顺序：项目 → 服务 → 部署 → 节点 → 分支 → commit → 域名
    const order: ResultCategory[] = ['project', 'service', 'deployment', 'node', 'branch', 'commit', 'domain']
    const rank = new Map(order.map((c, i) => [c, i] as const))
    return filtered
      .sort((a, b) => (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99))
      .slice(0, maxResults)
  })

  // 监听 query 变化：防抖拉取
  watch(query, () => {
    scheduleRefresh()
  })

  return {
    query,
    results,
    loading,
    error,
    refresh,
  }
}
