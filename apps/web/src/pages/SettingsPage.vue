<template>
  <div>
    <h2>设置</h2>
    <a-card title="系统信息" style="margin-top: 16px;">
      <a-descriptions bordered size="small" :column="1">
        <a-descriptions-item label="应用名称">Launchly</a-descriptions-item>
        <a-descriptions-item label="版本">1.0.0</a-descriptions-item>
        <a-descriptions-item label="数据库">PostgreSQL</a-descriptions-item>
        <a-descriptions-item label="Worker 数量">1</a-descriptions-item>
        <a-descriptions-item label="数据目录">~/.launchly</a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>
