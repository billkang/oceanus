# 任务 009 — 登录页实现

**Epic:** 前端页面开发
**优先级:** P0
**关联需求:** FR-1

---

## 描述

实现 Oceanus 登录页，用户输入测试账号密码即可登录。

## 页面要素

- 居中的登录卡片
- 用户名输入框（PrimeNG InputText）
- 密码输入框（PrimeNG Password）
- 登录按钮（PrimeNG Button）
- 登录失败时展示错误提示消息
- Oceanus Logo 和标题

## 交互细节

- 登录成功后跳转到项目列表页
- 登录失败显示"账号或密码错误"提示
- 已登录用户直接跳转到项目列表（通过路由守卫实现）

## 验收标准

- [ ] 登录页正常渲染，PrimeNG 风格
- [ ] 输入 admin/oceanus123 可成功登录
- [ ] 错误密码显示错误提示
- [ ] 已登录用户访问登录页自动跳转
- [ ] Token 过期后跳回登录页

## 技术要点

- 使用 Angular Reactive Forms 做表单验证
- JWT Token 存储在 localStorage
- 创建 AuthGuard 路由守卫保护页面
- HttpClient Interceptor 自动附加 Token
