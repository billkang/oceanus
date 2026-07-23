# 任务 003 — Auth Module — 测试账号登录 + JWT Token

**Epic:** 后端 API 开发
**优先级:** P0
**关联需求:** FR-1

---

## 描述

实现测试账号登录功能，写死一个测试账号，用户输入账号密码后返回 JWT Token 用于后续请求认证。

## API 接口

### POST /api/auth/login
**请求体:**
```json
{
  "username": "admin",
  "password": "oceanus123"
}
```
**响应:**
```json
{
  "token": "jwt-token-string",
  "user": {
    "id": "uuid",
    "username": "admin",
    "displayName": "管理员"
  }
}
```

### GET /api/auth/me
获取当前登录用户信息（需携带 JWT Token）。

## 验收标准

- [ ] 写死的测试账号（admin/oceanus123）可成功登录
- [ ] 错误密码返回 401
- [ ] JWT Token 过期时间合理（建议 24h）
- [ ] 登录后后续请求携带 Token 可正常认证
- [ ] Guard/Interceptor 拦截未认证请求

## 技术要点

- 使用 `@nestjs/jwt` 生成和验证 Token
- 密码使用 bcrypt 加密存储（seed 时预置）
- 创建全局 JwtAuthGuard
- MVP 阶段不做注册/密码找回功能
