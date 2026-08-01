# session-recovery Specification

## Purpose

会话恢复能力：用户重新进入有未完成 AI 响应的会话时检测并提示是否恢复，中断后重新进入时保留并恢复上下文，支持继续讨论或从零开始。

## Requirements

### Requirement: 会话恢复检测

用户重新进入一个已有活动的会话时，系统 SHALL 检测是否需要恢复。

#### Scenario: 提示恢复

- **WHEN** 用户重新进入一个仍有未完成 AI 响应的会话
- **THEN** 提示"检测到未完成的讨论，是否恢复？"
- **WHEN** 用户选择"恢复"
- **THEN** SDK 调用 resume(sessionId) 继续之前的讨论
- **WHEN** 用户选择"不恢复"
- **THEN** 创建一个新的上下文，从头开始

### Requirement: 断开后状态保持

用户在 AI 响应中断开（关闭页面/网络波动），重新进入后系统 SHALL 保留上下文。

#### Scenario: 中断后恢复

- **WHEN** AI 正在响应时用户关闭页面
- **WHEN** 用户重新打开页面并进入该会话
- **THEN** 提示恢复，选择恢复后 SDK 继续之前的响应（或重新从断点开始）
