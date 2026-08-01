# notification-system Specification

## Purpose

前端全局通知能力：通过 NotificationService 提供 4 级严重程度的 Toast 通知，并由 AuthInterceptor 将常见 HTTP 错误自动转换为通知。

## Requirements

### Requirement: Toast 通知服务

前端 SHALL 提供全局通知服务（`NotificationService`），支持 4 种严重级别，自动关闭和手动关闭。

#### Scenario: 错误通知

- **WHEN** 系统需要展示错误消息（如网络错误、API 500）
- **THEN** 调用 `NotificationService.error(summary, detail)`
- **THEN** 右上角显示红色 toast，8 秒后自动关闭
- **THEN** 用户可点击 toast 或 × 按钮提前关闭

#### Scenario: 警告通知

- **WHEN** 系统需要展示警告信息
- **THEN** 调用 `NotificationService.warn(summary, detail)`
- **THEN** 显示琥珀色 toast，6 秒后自动关闭

#### Scenario: 成功通知

- **WHEN** 操作成功（如项目创建完成）
- **THEN** 调用 `NotificationService.success(summary, detail)`
- **THEN** 显示靛蓝色 toast，4 秒后自动关闭

#### Scenario: 信息通知

- **WHEN** 系统需要展示一般信息
- **THEN** 调用 `NotificationService.info(summary, detail)`
- **THEN** 显示蓝色 toast，4 秒后自动关闭

#### Scenario: 多条通知共存

- **WHEN** 多个通知同时展示
- **THEN** 通知在右上角垂直堆叠（最新在上）
- **THEN** 每条通知独立关闭，互不影响

### Requirement: Toast 视觉样式

Toast 组件（`ErrorToastComponent`）SHALL 在页面右上角固定定位，使用幻灯片入场动画。

#### Scenario: 通知展示

- **WHEN** 通知被添加到服务
- **THEN** toast 从右侧滑入（`animate-slide-in` CSS 动画，300ms ease-out）
- **THEN** 显示 severity 对应的背景色 + 白色文字
- **THEN** 显示 summary（粗体）和 detail（小字）

#### Scenario: 通知关闭

- **WHEN** 用户点击 toast 或 × 按钮
- **THEN** toast 从列表中移除

#### Scenario: 通知数量上限

- **WHEN** 通知数量超过合理范围（如 5 条以上）
- **THEN** 最旧的通知可能被新通知挤出可视区域（通过 fixed 定位的垂直堆叠）

### Requirement: HTTP 错误拦截

AuthInterceptor SHALL 拦截所有 HTTP 响应，将常见错误自动转换为通知。

#### Scenario: 401 未认证

- **WHEN** API 返回 401
- **THEN** 自动跳转到 `/login` 页面，携带 `redirect` 参数

#### Scenario: 网络错误（status 0）

- **WHEN** API 调用失败且 status 为 0（网络不可达）
- **THEN** 显示 "网络错误" toast

#### Scenario: 服务器错误（5xx）

- **WHEN** API 返回 5xx 状态码
- **THEN** 显示 "服务器错误" toast

#### Scenario: SSE 连接认证

- **WHEN** EventSource 无法设置自定义请求头
- **THEN** JwtAuthGuard 同时支持 URL 查询参数 `?token=xxx` 传递 JWT Token
- **THEN** 验证逻辑与 Bearer header 一致
