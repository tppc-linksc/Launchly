import { describe, it, expect } from 'vitest'
import {
  deployStatusMap,
  issueStatusMap,
  testResultMap,
  testRunStatusMap,
  envTypeMap,
  deployStageMap,
  priorityMap,
  releaseStatusMap,
  gateNameMap,
  deployModeMap,
  dataStrategyMap,
  auditActionMap,
  formatTime,
} from './display'

describe('display maps', () => {
  it('deployStatusMap covers all statuses', () => {
    expect(deployStatusMap.PENDING).toBe('等待中')
    expect(deployStatusMap.RUNNING).toBe('运行中')
    expect(deployStatusMap.SUCCEEDED).toBe('成功')
    expect(deployStatusMap.FAILED).toBe('失败')
    expect(deployStatusMap.CANCELED).toBe('已取消')
  })

  it('issueStatusMap covers all statuses', () => {
    expect(issueStatusMap.OPEN).toBe('待处理')
    expect(issueStatusMap.ASSIGNED).toBe('已指派')
    expect(issueStatusMap.FIXING).toBe('修复中')
    expect(issueStatusMap.FIXED).toBe('待复测')
    expect(issueStatusMap.CLOSED).toBe('已关闭')
    expect(issueStatusMap.REOPENED).toBe('重新打开')
  })

  it('testResultMap covers all results', () => {
    expect(testResultMap.PASSED).toBe('通过')
    expect(testResultMap.FAILED).toBe('失败')
    expect(testResultMap.BLOCKED).toBe('阻塞')
    expect(testResultMap.SKIPPED).toBe('跳过')
  })

  it('envTypeMap covers environment types', () => {
    expect(envTypeMap.TEST).toBe('测试环境')
    expect(envTypeMap.STAGING).toBe('预发环境')
    expect(envTypeMap.PRODUCTION).toBe('生产环境')
  })

  it('deployStageMap covers all stages', () => {
    expect(deployStageMap.CLONE).toBe('克隆代码')
    expect(deployStageMap.BUILD).toBe('构建')
    expect(deployStageMap.DEPLOY).toBe('部署')
    expect(deployStageMap.HEALTH_CHECK).toBe('健康检查')
  })

  it('priorityMap covers all priorities', () => {
    expect(priorityMap.P0).toBe('P0 阻塞')
    expect(priorityMap.P1).toBe('P1 高')
    expect(priorityMap.P2).toBe('P2 中')
    expect(priorityMap.P3).toBe('P3 低')
  })

  it('releaseStatusMap covers all statuses', () => {
    expect(releaseStatusMap.DRAFT).toBe('草稿')
    expect(releaseStatusMap.READY).toBe('就绪')
    expect(releaseStatusMap.PUBLISHED).toBe('已发布')
  })

  it('auditActionMap covers key actions', () => {
    expect(auditActionMap.LOGIN).toBe('登录')
    expect(auditActionMap.CREATE_PROJECT).toBe('创建项目')
    expect(auditActionMap.TRIGGER_DEPLOY).toBe('触发部署')
  })
})

describe('formatTime', () => {
  it('returns — for null/undefined', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime(undefined)).toBe('—')
    expect(formatTime('')).toBe('—')
  })

  it('formats valid ISO string', () => {
    const result = formatTime('2026-01-15T10:30:00.000Z')
    expect(result).not.toBe('—')
    expect(result).toContain('2026')
  })

  it('returns Invalid Date string for non-ISO input', () => {
    const result = formatTime('not-a-date')
    expect(result).toBe('Invalid Date')
  })
})
