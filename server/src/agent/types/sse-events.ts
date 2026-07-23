/** SSE 事件类型枚举 */
export enum SseEventType {
  SessionCreated = 'session_created',
  ConfirmAccepted = 'confirm_accepted',
  MessageStart = 'message_start',
  MessageDelta = 'message_delta',
  MessageDone = 'message_done',
  MessageComplete = 'message_complete',
  StreamComplete = 'stream_complete',
  ToolInProgress = 'tool_in_progress',
  ToolComplete = 'tool_complete',
  ToolOptions = 'tool_options',
  AssetReady = 'asset_ready',
  TitleUpdated = 'title_updated',
  Error = 'error',
  AiNotConfigured = 'ai_not_configured',
}

/** SSE 事件 — 会话已创建（首条消息时推送 sdkSessionId） */
export interface SseSessionCreated {
  type: SseEventType.SessionCreated;
  data: { sdkSessionId: string };
}

/** SSE 事件 — 用户确认已接收 */
export interface SseConfirmAccepted {
  type: SseEventType.ConfirmAccepted;
  data: Record<string, never>;
}

/** SSE 事件 — 文本块开始 */
export interface SseMessageStart {
  type: SseEventType.MessageStart;
  data: { content: string };
}

/** SSE 事件 — 文本块追加 */
export interface SseMessageDelta {
  type: SseEventType.MessageDelta;
  data: { content: string };
}

/** SSE 事件 — 当前块完成 */
export interface SseMessageDone {
  type: SseEventType.MessageDone;
  data: Record<string, never>;
}

/** SSE 事件 — 整条消息完成 */
export interface SseMessageComplete {
  type: SseEventType.MessageComplete;
  data: Record<string, never>;
}

/** SSE 事件 — 流全部完成 */
export interface SseStreamComplete {
  type: SseEventType.StreamComplete;
  data: Record<string, never>;
}

/** SSE 事件 — 工具调用中（分析中/生成中） */
export interface SseToolInProgress {
  type: SseEventType.ToolInProgress;
  data: { status: string };
}

/** SSE 事件 — 工具调用完成 */
export interface SseToolComplete {
  type: SseEventType.ToolComplete;
  data: Record<string, never>;
}

/** SSE 事件 — 等待用户确认选项 */
export interface SseToolOptions {
  type: SseEventType.ToolOptions;
  data: { options: string[]; text?: string };
}

/** SSE 事件 — 资产已就绪 */
export interface SseAssetReady {
  type: SseEventType.AssetReady;
  data: { assetId: number; title: string };
}

/** SSE 事件 — 标题已更新 */
export interface SseTitleUpdated {
  type: SseEventType.TitleUpdated;
  data: { sdkSessionId: string; title: string };
}

/** SSE 事件 — 错误 */
export interface SseError {
  type: SseEventType.Error;
  data: { message: string };
}

/** SSE 事件 — AI 服务未配置 */
export interface SseAiNotConfigured {
  type: SseEventType.AiNotConfigured;
  data: { message: string };
}

/** 所有 SSE 事件类型的联合 */
export type SseEvent =
  | SseSessionCreated
  | SseConfirmAccepted
  | SseMessageStart
  | SseMessageDelta
  | SseMessageDone
  | SseMessageComplete
  | SseStreamComplete
  | SseToolInProgress
  | SseToolComplete
  | SseToolOptions
  | SseAssetReady
  | SseTitleUpdated
  | SseError
  | SseAiNotConfigured;
