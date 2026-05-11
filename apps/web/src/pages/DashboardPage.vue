<template>
  <div>
    <h2>仪表盘</h2>
    <p style="color: #8c8c8c; margin-bottom: 24px;">查看工作空间整体状态，快速了解项目、部署与待办事项。</p>
    <a-alert type="info" show-icon message="当前为开发骨架阶段" description="功能模块将在后续开发计划中逐步实现。" style="margin-bottom: 24px" />
    <a-row :gutter="16">
      <a-col :span="6"><a-card>项目数量<div style="font-size: 28px; font-weight: 600; margin-top: 8px;">—</div></a-card></a-col>
      <a-col :span="6"><a-card>最近部署<div style="font-size: 28px; font-weight: 600; margin-top: 8px;">—</div></a-card></a-col>
      <a-col :span="6"><a-card>待处理 Issue<div style="font-size: 28px; font-weight: 600; margin-top: 8px;">—</div></a-card></a-col>
      <a-col :span="6"><a-card>待复测 Issue<div style="font-size: 28px; font-weight: 600; margin-top: 8px;">—</div></a-card></a-col>
    </a-row>
  </div>
</template>
