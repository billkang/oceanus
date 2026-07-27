---
status: accepted
date: 2026-07-23
deciders: billkang
---

# ADR-007: MVP 认证策略

## 背景

MVP 阶段需要快速实现用户认证，降低复杂度。

## 决策

**写死测试账号 → JWT Token。**

- 后端预置测试账号（admin / admin123）
- 登录成功返回 JWT Token
- 前端 HTTP Interceptor 自动注入 Token
- 401 响应自动重定向到登录页

### 后续演进

| Phase | 方案               |
| ----- | ------------------ |
| MVP   | 静态测试账号 + JWT |
| 后续  | SSO / LDAP 集成    |

## 影响

- 无注册流程
- 无密码找回
- 无角色权限体系（所有登录用户为管理员）
