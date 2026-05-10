<template>
  <a-layout class="app-shell">
    <a-layout-sider width="232" theme="light">
      <div class="brand">Launchly</div>
      <a-menu mode="inline" :selected-keys="['dashboard']">
        <a-menu-item key="dashboard">Dashboard</a-menu-item>
        <a-menu-item key="projects">Projects</a-menu-item>
        <a-menu-item key="deployments">Deployments</a-menu-item>
        <a-menu-item key="tests">Tests</a-menu-item>
        <a-menu-item key="issues">Issues</a-menu-item>
        <a-menu-item key="releases">Releases</a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="topbar">
        <span>Default Workspace</span>
      </a-layout-header>
      <a-layout-content class="content">
        <h1>Dashboard</h1>
        <p>Launchly scaffold is ready. Product modules will be implemented from the weekly task plan.</p>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.brand {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-weight: 700;
  border-bottom: 1px solid #f0f0f0;
}

.topbar {
  height: 56px;
  line-height: 56px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  padding: 0 24px;
}

.content {
  padding: 24px;
}
</style>

