// 部署状态
export const deployStatusMap: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '运行中',
  SUCCEEDED: '成功',
  FAILED: '失败',
  CANCELED: '已取消',
}

// Issue 状态
export const issueStatusMap: Record<string, string> = {
  OPEN: '待处理',
  ASSIGNED: '已指派',
  FIXING: '修复中',
  FIXED: '待复测',
  REOPENED: '重新打开',
  CLOSED: '已关闭',
}

// 测试结果
export const testResultMap: Record<string, string> = {
  PASSED: '通过',
  FAILED: '失败',
  BLOCKED: '阻塞',
  SKIPPED: '跳过',
}

// 测试执行状态
export const testRunStatusMap: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '运行中',
  COMPLETED: '已完成',
}

// 环境类型
export const envTypeMap: Record<string, string> = {
  TEST: '测试环境',
  STAGING: '预发环境',
  PRODUCTION: '生产环境',
}

// 部署阶段
export const deployStageMap: Record<string, string> = {
  CLONE: '克隆代码',
  BUILD: '构建',
  DEPLOY: '部署',
  HEALTH_CHECK: '健康检查',
}

// 优先级
export const priorityMap: Record<string, string> = {
  P0: 'P0 阻塞',
  P1: 'P1 高',
  P2: 'P2 中',
  P3: 'P3 低',
}

// 发布状态
export const releaseStatusMap: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_GATES: '门禁检查中',
  READY: '就绪',
  PUBLISHED: '已发布',
  FAILED: '失败',
}

// 门禁项
export const gateNameMap: Record<string, string> = {
  staging_deploy_success: '预发部署成功',
  staging_health_check: '预发健康检查',
  p0_tests_passed: 'P0 测试通过',
  no_open_p0p1_issues: '无未关闭 P0/P1 Issue',
  auto_test_passed: '自动化测试通过',
}

// 部署模式
export const deployModeMap: Record<string, string> = {
  local: '本地部署',
  remote: '旧版 remote（勿用）',
}

// 数据策略
export const dataStrategyMap: Record<string, string> = {
  isolated: '隔离数据',
  sanitized: '脱敏数据',
  real: '真实数据',
}

// 审计操作
export const auditActionMap: Record<string, string> = {
  LOGIN: '登录',
  CREATE_PROJECT: '创建项目',
  DELETE_PROJECT: '删除项目',
  UPDATE_PROJECT: '修改项目',
  UPDATE_ENV_VAR: '修改环境变量',
  TRIGGER_DEPLOY: '触发部署',
  PUBLISH_PRODUCTION: '生产发布',
  ROLLBACK: '回滚',
  CREATE_INVITATION: '创建邀请',
  UPDATE_MEMBER_ROLE: '修改成员角色',
  GATE_EXEMPT: '门禁豁免',
  DELETE_RECORD: '删除记录',
}
