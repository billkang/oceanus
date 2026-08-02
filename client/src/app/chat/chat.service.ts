import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

/** SSE 事件类型枚举 — 与后端 sse-events.ts 对齐 */
export enum SseEventType {
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
  SessionCreated = 'session_created',
  ConfirmAccepted = 'confirm_accepted',
  Error = 'error',
  AiNotConfigured = 'ai_not_configured',
  SseError = 'sse_error',
  Queued = 'queued',
  QueuePosition = 'queue_position',
  Dequeued = 'dequeued',
  TurnLimitReached = 'turn_limit_reached',
  BudgetLimitReached = 'budget_limit_reached',
}

/** SSE 事件 */
export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  status?: 'streaming' | 'complete' | 'error';
}

/** SSE 流事件回调 */
export interface SseStreamCallbacks {
  onEvent: (event: SseEvent) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
}

/** 可用模型信息（镜像后端 ModelInfo：name/displayName/default） */
export interface ModelInfo {
  name: string;
  displayName: string;
  default: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  private getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('oceanus_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * 发送消息（首条 or 续传），返回 AbortController 用于中断
   * SSE 事件通过 onEvent 回调实时推送
   */
  sendMessage(
    options: {
      content: string;
      sessionId?: string;
      /** 项目 projectName，新会话首条消息必传（成员校验 + 分区） */
      projectName?: string;
      model?: string;
    } & SseStreamCallbacks,
  ): AbortController {
    const abortController = new AbortController();

    const body: Record<string, unknown> = {
      action: 'message',
      content: options.content,
    };
    if (options.sessionId) body['sessionId'] = options.sessionId;
    if (options.projectName) body['projectName'] = options.projectName;
    if (options.model) body['model'] = options.model;

    this.readSseStream('/api/v1/chat', body, abortController, options);

    return abortController;
  }

  /**
   * 确认选择，返回 AbortController
   */
  confirmChoice(
    options: {
      sessionId: string;
      confirmOption: string;
      model?: string;
    } & SseStreamCallbacks,
  ): AbortController {
    const abortController = new AbortController();

    const body: Record<string, unknown> = {
      action: 'confirm',
      sessionId: options.sessionId,
      confirmOption: options.confirmOption,
    };
    if (options.model) body['model'] = options.model;

    this.readSseStream('/api/v1/chat', body, abortController, options);

    return abortController;
  }

  /**
   * 中断响应
   */
  cancelResponse(sessionId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/api/v1/chat`,
      { action: 'cancel', sessionId },
      { headers: this.getAuthHeaders() as Record<string, string> },
    );
  }

  /** 加载历史消息 */
  loadHistory(sdkSessionId: string): Observable<unknown> {
    return this.http.get(`/api/v1/sessions/${sdkSessionId}/messages`);
  }

  /** 获取可用模型列表（多模型时前端渲染选择器） */
  getModels(): Observable<ModelInfo[]> {
    return this.http.get<ModelInfo[]>('/api/v1/models', { headers: this.getAuthHeaders() });
  }

  /**
   * 使用 fetch 读取 SSE 流
   */
  private async readSseStream(
    url: string,
    body: Record<string, unknown>,
    abortController: AbortController,
    { onEvent, onComplete, onError }: SseStreamCallbacks,
  ): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        // 非 SSE 响应（如 400/500）直接抛出
        const text = await response.text().catch(() => '');
        onError?.(text || `HTTP ${response.status}`);
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              onEvent({ type: currentEvent, data: parsed.data ?? parsed });
            } catch {
              // ignore malformed JSON
            }
          }
        }
      }

      // 处理 buffer 剩余内容
      if (buffer.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(buffer.slice(6));
          onEvent({ type: currentEvent, data: parsed.data ?? parsed });
        } catch {
          /* ignore */
        }
      }

      onComplete?.();
    } catch (err) {
      const errMsg = (err as Error).message;
      if ((err as Error).name !== 'AbortError') {
        onError?.(errMsg);
      }
    }
  }
}
