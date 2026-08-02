# asset-panel Specification

## ADDED Requirements

### Requirement: 资产访问权限

资产相关端点 SHALL 校验当前用户对资产的所有权，非所有者一律返回 404。所有权通过 `asset → session → username` 链路判定。

#### Scenario: 列表按会话过滤

- **WHEN** 当前用户请求某会话的资产列表（listBySession）
- **THEN** 服务端校验该会话属于当前用户（`session.username === 当前用户`，非所有者返回 404）
- **THEN** 仅返回该会话下当前用户可见的资产

#### Scenario: 查看/下载/复制资产

- **WHEN** 当前用户请求查看（getById）、下载（download）或复制（copy）某资产
- **THEN** 服务端按 `asset → session → username` 链路校验所有权（非所有者返回 404）

#### Scenario: 越权访问统一 404

- **WHEN** 请求涉及其他用户的会话及其资产
- **THEN** 服务端统一返回 404（不区分"不存在"与"无权限"）
