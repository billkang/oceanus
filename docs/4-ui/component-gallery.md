# 前端组件与布局

> TODO: UI 组件文档待完善。当前技术栈为 Angular 21 + PrimeNG 21 + Tailwind CSS 4。

## 架构原则

- Standalone 组件（无 NgModule）
- OnPush 变更检测
- Signal 响应式状态管理
- inline template
- 函数式路由守卫（AuthGuard）

## 路由结构

| 路径                     | 组件               | 说明                |
| ------------------------ | ------------------ | ------------------- |
| `/login`                 | LoginComponent     | 登录页              |
| `/workspace/:id`         | WorkspaceComponent | 三栏工作台          |
| `/workspace/:id/chat`    | ChatComponent      | 聊天 + SSE 流式渲染 |
| `/workspace/:id/asset`   | AssetComponent     | 资产面板            |
| `/workspace/:id/project` | ProjectComponent   | 项目管理            |
| `/workspace/:id/session` | SessionComponent   | 会话管理            |
