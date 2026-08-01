# user-auth Specification

## Purpose

用户认证能力：预置测试账号登录生成 JWT Token，并校验 Token 有效性，过期或无效时返回 401。

## Requirements

### Requirement: 测试账号登录

系统 SHALL 预置写死的测试账号，用户输入正确账号密码后生成 JWT Token。

#### Scenario: 正确账号登录成功

- **WHEN** 用户输入测试账号 admin / oceanus123
- **THEN** 系统验证通过，返回 JWT Token 并跳转到项目列表页

#### Scenario: 错误密码登录失败

- **WHEN** 用户输入错误的密码
- **THEN** 系统返回 401 错误，显示"账号或密码错误"提示，不清除已输入内容

#### Scenario: 已登录用户自动鉴权

- **WHEN** 用户携带有效 JWT Token 请求接口
- **THEN** 系统验证 Token 通过，正常返回数据

#### Scenario: Token 过期或无效

- **WHEN** 用户携带过期或无效的 JWT Token
- **THEN** 系统返回 401，前端跳转到登录页
