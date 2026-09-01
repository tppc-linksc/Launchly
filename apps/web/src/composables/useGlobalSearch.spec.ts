/**
 * 测试：KI-014 / useGlobalSearch
 *
 * - 不发起请求时 query 默认空，results 为空数组。
 * - 输入 query 触发 fetchProjects / fetchDeployments / fetchAllDeployTargets 三个并发请求。
 * - 命中项目标题、节点名称、部署 ID、commit SHA、分支、仓库地址。
 * - 客户端关键词过滤忽略大小写。
 * - 结果按类别排序：项目 > 服务 > 部署 > 节点 > 分支 > commit > 域名。
 * - 单个数据源失败时不阻塞其它来源。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/client', () => ({
  fetchProjects: vi.fn(),
  fetchDeployments: vi.fn(),
  fetchAllDeployTargets: vi.fn(),
}))

import { fetchProjects, fetchDeployments, fetchAllDeployTargets } from '../api/client'
import { useGlobalSearch } from './useGlobalSearch'

const PROJECTS = [
  { id: 'p1', name: 'Marketing Site', description: 'marketing website', projectType: 'APP', resourceKind: 'APPLICATION', repositoryUrl: 'https://github.com/acme/marketing.git', defaultBranch: 'main' },
  { id: 'p2', name: 'API Server', description: 'backend api', projectType: 'APP', resourceKind: 'APPLICATION', repositoryUrl: 'git@github.com:acme/api.git', defaultBranch: 'develop' },
]

const DEPLOYMENTS = [
  { id: 'd-100', projectId: 'p1', projectName: 'Marketing Site', status: 'SUCCEEDED', branch: 'feature/hero', commitSha: 'abc1234', environmentName: 'TEST' },
  { id: 'd-101', projectId: 'p2', projectName: 'API Server', status: 'FAILED', branch: 'main', commitSha: 'deadbeef', environmentName: 'PROD' },
]

const TARGETS = [
  { id: 't1', name: 'prod-node-1', host: '192.168.1.10', port: 22, username: 'deploy', projectId: 'p1', projectName: 'Marketing Site', type: 'SSH' },
  { id: 't2', name: 'test-node', host: '192.168.1.20', port: 22, username: 'deploy', projectId: 'p2', projectName: 'API Server', type: 'SSH' },
]

// 工具：等待防抖结束 + 一次微任务循环
async function settle() {
  await new Promise(r => setTimeout(r, 250))
  await Promise.resolve()
  await Promise.resolve()
}

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.mocked(fetchProjects).mockReset()
    vi.mocked(fetchDeployments).mockReset()
    vi.mocked(fetchAllDeployTargets).mockReset()
    vi.mocked(fetchProjects).mockResolvedValue({ data: PROJECTS } as any)
    vi.mocked(fetchDeployments).mockResolvedValue({ data: DEPLOYMENTS } as any)
    vi.mocked(fetchAllDeployTargets).mockResolvedValue({ data: TARGETS } as any)
  })

  it('GS.1 默认 query 为空且 results 为空数组', () => {
    const { query, results } = useGlobalSearch()
    expect(query.value).toBe('')
    expect(results.value).toEqual([])
  })

  it('GS.2 输入 query 会同时调用 fetchProjects / fetchDeployments / fetchAllDeployTargets', async () => {
    const { query } = useGlobalSearch()
    query.value = 'site'
    await settle()
    expect(fetchProjects).toHaveBeenCalledTimes(1)
    expect(fetchDeployments).toHaveBeenCalledTimes(1)
    expect(fetchAllDeployTargets).toHaveBeenCalledTimes(1)
  })

  it('GS.3 按项目标题命中（不区分大小写）', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'MARKETING'
    await settle()
    const titles = results.value.map(r => r.title)
    expect(titles.join(' ')).toContain('Marketing Site')
  })

  it('GS.4 按节点名称命中', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'prod-node'
    await settle()
    const nodeHits = results.value.filter(r => r.category === 'node')
    expect(nodeHits.length).toBeGreaterThan(0)
    expect(nodeHits[0].title).toBe('prod-node-1')
    expect(nodeHits[0].path).toBe('/deploy-targets')
  })

  it('GS.5 按部署 ID 命中', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'd-100'
    await settle()
    const dep = results.value.find(r => r.category === 'deployment')
    expect(dep).toBeTruthy()
    expect(dep!.title).toBe('部署 d-100')
    expect(dep!.path).toBe('/deployments/d-100')
  })

  it('GS.6 按 commit SHA 命中', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'deadbeef'
    await settle()
    const commit = results.value.find(r => r.category === 'commit')
    expect(commit).toBeTruthy()
    expect(commit!.title).toContain('deadbeef')
  })

  it('GS.7 按分支名命中（默认分支 + 部署分支）', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'feature/hero'
    await settle()
    const branches = results.value.filter(r => r.category === 'branch')
    expect(branches.length).toBeGreaterThan(0)
    expect(branches.map(b => b.title).join('|')).toContain('feature/hero')
  })

  it('GS.8 按域名/仓库地址命中', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'marketing'
    await settle()
    const domain = results.value.find(r => r.category === 'domain')
    expect(domain).toBeTruthy()
    expect(domain!.title).toContain('github.com/acme/marketing')
  })

  it('GS.9 结果按类别排序：项目 > 服务 > 部署 > 节点 > 分支 > commit > 域名', async () => {
    const { query, results } = useGlobalSearch()
    query.value = 'a'
    await settle()
    const order = results.value.map(r => r.category)
    const rank = { project: 0, service: 1, deployment: 2, node: 3, branch: 4, commit: 5, domain: 6 }
    for (let i = 1; i < order.length; i++) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]])
    }
  })

  it('GS.10 单个数据源失败不影响其它来源', async () => {
    vi.mocked(fetchProjects).mockRejectedValueOnce(new Error('boom'))
    const { query, results } = useGlobalSearch()
    query.value = 'prod-node'
    await settle()
    expect(results.value.find(r => r.category === 'node')).toBeTruthy()
  })

  it('GS.11 结果数受 maxResults 限制', async () => {
    const { query, results } = useGlobalSearch({ maxResults: 1 })
    query.value = 'a'
    await settle()
    expect(results.value.length).toBeLessThanOrEqual(1)
  })

  it('GS.12 空 query 不会返回任何结果（避免一次性展示几百条）', async () => {
    const { query, results } = useGlobalSearch()
    query.value = '   '
    await settle()
    expect(results.value).toEqual([])
  })
})
