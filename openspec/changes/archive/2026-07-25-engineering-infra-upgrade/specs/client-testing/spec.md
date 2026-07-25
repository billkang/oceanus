## ADDED Requirements

### Requirement: user-menu 组件有单元测试

`UserMenuComponent` SHALL 具备基于 Vitest + Angular TestBed 的单元测试，覆盖组件创建、用户信息展示、菜单交互。

#### Scenario: 组件正常创建

- **WHEN** TestBed 编译并创建 `UserMenuComponent` 实例
- **THEN** 组件实例成功创建，不抛出异常

#### Scenario: 显示用户信息

- **WHEN** 用户已登录且有用户名
- **THEN** 组件模板渲染用户名和头像

#### Scenario: 菜单项点击触发

- **WHEN** 用户点击菜单中的某一项
- **THEN** 对应的事件处理函数被调用

### Requirement: 一个核心业务页面有单元测试

核心业务组件（Chat 组件）SHALL 具备单元测试，覆盖消息展示、输入交互、流式状态处理。

#### Scenario: 消息列表渲染

- **WHEN** Chat 组件接收到消息列表数据
- **THEN** 模板正确渲染所有消息的内容和角色标识

#### Scenario: 输入框交互

- **WHEN** 用户在输入框输入文本并点击发送
- **THEN** 组件调用发送消息的服务方法，输入框被清空

#### Scenario: 流式状态显示

- **WHEN** AI 正在生成回复（isStreaming = true）
- **THEN** 发送按钮变为中断按钮，输入框保持禁用或显示加载状态

### Requirement: 测试通过后 CI 中验证

客户端测试套件 SHALL 在 CI 流水线的 test 阶段执行并通过。

#### Scenario: CI 执行客户端测试

- **WHEN** CI test 阶段运行 `pnpm --filter @oceanus/client test`
- **THEN** Vitest 在 jsdom 环境中执行所有 `*.spec.ts` 文件，全部通过则阶段成功
