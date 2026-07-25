import type {
  SDKMessage,
  SDKPromptSuggestionMessage,
  SDKResultSuccess,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AgentService } from '../agent/agent.service';
import type { SseEvent } from '../agent/types/sse-events';
import { SseEventType } from '../agent/types/sse-events';
import { AssetService } from '../asset/asset.service';
import { SessionService } from '../session/session.service';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { SessionLogService } from '../common/logging/session-log.service';

/** SSE 事件回调 */
export type SseEventCallback = (event: SseEvent) => void;

/** sendAndStream 参数 */
export interface SendStreamOptions {
  content: string;
  sdkSessionId?: string;
  projectId?: string | number;
  onEvent: SseEventCallback;
}

/** confirmAndStream 参数 */
export interface ConfirmStreamOptions {
  sdkSessionId: string;
  confirmOption: string;
  onEvent: SseEventCallback;
}

/**
 * 内容追踪器 — 在 mapper 和 main loop 之间传递块级状态，
 * 用于 Langfuse 记录 thinking / generation 内容。
 *
 * 使用方法而非直接赋值，避免 no-param-reassign 违规。
 */
class ContentTracker {
  blockStack: string[] = [];
  /** 当前 thinking 块已累积的文本 */
  thinkingText = '';
  /** mapper 在 thinking 块完成时写入，main loop 读取后清空 */
  completedThinking: string | null = null;
  /** mapper 在 text 块完成时写入（含完整文本），main loop 读取后清空 */
  completedText: string | null = null;

  resetThinkingText(): void {
    this.thinkingText = '';
  }

  appendThinkingText(text: string): void {
    this.thinkingText += text;
  }

  markThinkingComplete(): void {
    this.completedThinking = this.thinkingText;
    this.thinkingText = '';
  }

  clearCompletedThinking(): void {
    this.completedThinking = null;
  }

  clearCompletedText(): void {
    this.completedText = null;
  }
}

@Injectable()
export class ChatService {
  /** 活跃的 SDK Query 引用，用于中断/取消 */
  private readonly activeQueries = new Map<string, { interrupt: () => Promise<unknown> }>();

  /** 每个会话的消息轮次计数（用于标题异步更新触发） */
  private readonly messageRoundCount = new Map<string, number>();

  /** 每个会话的首条用户消息（用于标题生成） */
  private readonly firstUserMessage = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    private readonly agentService: AgentService,
    private readonly sessionService: SessionService,
    private readonly assetService: AssetService,
    private readonly langfuseService: LangfuseService,
    private readonly sessionLogService: SessionLogService,
  ) {}

  /**
   * 发送消息并处理 SDK 事件流
   *
   * 无 sdkSessionId = 首条消息 → 自动捕获 system/init → 懒创建 Session
   * 有 sdkSessionId = 续传 → resume: sessionId
   */
  async sendAndStream(options: SendStreamOptions): Promise<void> {
    const { content, sdkSessionId, projectId, onEvent } = options;

    if (!content || content.trim().length === 0) {
      throw new Error('消息内容不能为空');
    }

    // 新会话 / 续传（__new__ 是前端的无效占位标记，等同无 sessionId）
    const normalizedSessionId = sdkSessionId === '__new__' ? undefined : sdkSessionId;
    let capturedSdkSessionId = normalizedSessionId;
    const isFirstMessage = !normalizedSessionId;

    // 续传时验证 session 存在
    if (!isFirstMessage) {
      try {
        await this.sessionService.getBySdkSessionId(normalizedSessionId!);
      } catch {
        throw new Error(`会话不存在: ${normalizedSessionId}`);
      }

      // 并发消息处理：中断旧流
      const existingQuery = this.activeQueries.get(normalizedSessionId!);
      if (existingQuery) {
        this.logger.debug(`Interrupting existing query for session ${normalizedSessionId}`);
        await existingQuery.interrupt();
        this.activeQueries.delete(normalizedSessionId!);
      }
    }

    // 跟踪首条用户消息
    this.messageRoundCount.set(capturedSdkSessionId ?? 'pending', 0);
    if (!this.firstUserMessage.has(capturedSdkSessionId ?? 'pending') && content.trim()) {
      this.firstUserMessage.set(capturedSdkSessionId ?? 'pending', content.trim());
    }

    // 累加响应文本（用于 PRD 提取和标题生成）
    let responseText = '';
    // 从 result 消息中提取的 token 用量
    let tokenUsage: { inputTokens?: number; outputTokens?: number } | undefined;

    // 内容追踪器，在 mapper 和 main loop 之间传递块级状态
    const tracker = new ContentTracker();

    try {
      const result = isFirstMessage
        ? await this.agentService.sendMessage(content)
        : await this.agentService.sendMessage(content, { resume: normalizedSessionId! });

      const { stream, interrupt } = result;

      if (!isFirstMessage) {
        this.activeQueries.set(normalizedSessionId!, { interrupt });
      }

      for await (const msg of stream) {
        // 首条消息：捕获 system/init 事件
        if (isFirstMessage && msg.type === 'system' && (msg as SDKSystemMessage).subtype === 'init') {
          capturedSdkSessionId = (msg as SDKSystemMessage & { session_id?: string }).session_id;

          if (capturedSdkSessionId) {
            // 懒创建 Session 记录
            const numericProjectId = projectId ? Number(projectId) : 1;
            await this.sessionService.create(numericProjectId, capturedSdkSessionId);

            // 为 Langfuse trace 创建 Trace（首条消息的 SessionStart hook 无 session_id，在此补充）
            this.langfuseService.createTrace(capturedSdkSessionId);

            onEvent({
              type: SseEventType.SessionCreated,
              data: { sdkSessionId: capturedSdkSessionId },
            });

            this.activeQueries.set(capturedSdkSessionId, { interrupt });
            this.messageRoundCount.set(capturedSdkSessionId, 0);
            this.firstUserMessage.set(capturedSdkSessionId, content.trim());

            this.logger.log(`Session created: ${capturedSdkSessionId}`);
            this.sessionLogService.log('default', capturedSdkSessionId, 'Session created', {
              content: content.slice(0, 100),
            });
          }
          continue;
        }

        // 捕获 result 消息中的 token 用量
        if (msg.type === 'result' && (msg as SDKResultSuccess).subtype === 'success') {
          const resultMsg = msg as SDKResultSuccess;
          if (resultMsg.usage) {
            tokenUsage = {
              inputTokens: resultMsg.usage.input_tokens,
              outputTokens: resultMsg.usage.output_tokens,
            };
          }
          if (capturedSdkSessionId) {
            this.sessionLogService.log('default', capturedSdkSessionId, 'Query completed', {
              turns: resultMsg.num_turns,
              usage: tokenUsage,
            });
          }
          continue;
        }

        const events = this.mapSdkMessageToSseEvents(msg, tracker);
        for (const event of events) {
          if (event.type === SseEventType.MessageDelta) {
            const deltaContent = (event.data as Record<string, unknown>).content || '';
            responseText += deltaContent;
          }
          onEvent(event);
        }

        // 处理 thinking 块完成 → 记录到 Langfuse
        if (tracker.completedThinking !== null && capturedSdkSessionId) {
          this.langfuseService.recordThinking(capturedSdkSessionId, tracker.completedThinking);
          this.sessionLogService.log('default', capturedSdkSessionId, 'Thinking block recorded', {
            thinkingLength: tracker.completedThinking.length,
          });
          tracker.clearCompletedThinking();
        }
      }

      const finalSessionId = capturedSdkSessionId;
      if (finalSessionId) {
        // 轮次+1
        const round = (this.messageRoundCount.get(finalSessionId) ?? 0) + 1;
        this.messageRoundCount.set(finalSessionId, round);

        // 记录 LLM Generation 到 Langfuse（含 token 用量）
        if (responseText.trim().length > 0) {
          this.langfuseService.recordGeneration(finalSessionId, content, responseText, tokenUsage);
        }

        // 刷新 Langfuse 数据（不清理 Trace，保留给多轮对话）
        await this.langfuseService.flushTrace(finalSessionId);

        await this.afterStreamComplete(finalSessionId, onEvent, responseText);
      }

      onEvent({ type: SseEventType.StreamComplete, data: {} });
    } catch (error) {
      const errMsg = (error as Error).message;
      this.logger.error(`Chat stream error: ${errMsg}`);
      if (capturedSdkSessionId) {
        this.sessionLogService.log('default', capturedSdkSessionId, 'Stream error', { error: errMsg });
      }
      onEvent({ type: SseEventType.Error, data: { message: errMsg } });
    } finally {
      if (capturedSdkSessionId) {
        this.activeQueries.delete(capturedSdkSessionId);
      }
    }
  }

  /**
   * 用户确认选择——等价于 resume 发一条消息
   */
  async confirmAndStream(options: ConfirmStreamOptions): Promise<void> {
    const { sdkSessionId, confirmOption, onEvent } = options;

    // 验证 session 存在
    try {
      await this.sessionService.getBySdkSessionId(sdkSessionId);
    } catch {
      throw new Error(`会话不存在: ${sdkSessionId}`);
    }

    onEvent({ type: SseEventType.ConfirmAccepted, data: {} });

    // resume 发一条消息，消息内容就是用户的选项
    await this.sendAndStream({
      content: confirmOption,
      sdkSessionId,
      onEvent,
    });
  }

  /**
   * 中断当前响应
   */
  async cancelResponse(sdkSessionId: string): Promise<void> {
    const query = this.activeQueries.get(sdkSessionId);
    if (query) {
      this.logger.debug(`Interrupting session ${sdkSessionId}`);
      await query.interrupt();
    } else {
      this.logger.warn(`No active query for session ${sdkSessionId}`);
    }
  }

  /**
   * 流完成后的处理：标题更新 + PRD 自动提取
   */
  private async afterStreamComplete(
    sdkSessionId: string,
    onEvent: SseEventCallback,
    responseText: string,
  ): Promise<void> {
    // 1. 标题异步更新
    onEvent({
      type: SseEventType.ToolInProgress,
      data: { status: '正在更新标题...' },
    });
    await this.tryUpdateTitle(sdkSessionId, onEvent);
    onEvent({ type: SseEventType.ToolComplete, data: {} });

    // 2. PRD 自动提取（响应足够长时）
    if (responseText.length >= 50) {
      onEvent({
        type: SseEventType.ToolInProgress,
        data: { status: '正在分析PRD...' },
      });
      await this.tryExtractPrd(sdkSessionId, responseText, onEvent);
      onEvent({ type: SseEventType.ToolComplete, data: {} });
    }
  }

  /**
   * 在 N 轮消息后自动生成会话标题
   */
  private async tryUpdateTitle(sdkSessionId: string, onEvent: SseEventCallback): Promise<void> {
    const round = this.messageRoundCount.get(sdkSessionId) ?? 0;
    if (round < 1) return; // 至少完成一轮才更新

    try {
      const session = await this.sessionService.getBySdkSessionId(sdkSessionId);
      if (session.title !== '新会话') return;

      const firstMsg = this.firstUserMessage.get(sdkSessionId) ?? '会话';
      const title = firstMsg.length > 30 ? firstMsg.slice(0, 30) + '…' : firstMsg;

      // 需要通过 numeric id 更新（Prisma 主键）
      await this.sessionService.updateTitle(session.id, title);
      this.logger.log(`Updated session ${session.id} title to: ${title}`);

      onEvent({
        type: SseEventType.TitleUpdated,
        data: { sdkSessionId, title },
      });
    } catch (error) {
      this.logger.warn(`Failed to update title for session ${sdkSessionId}: ${(error as Error).message}`);
    }
  }

  /**
   * 检测 Agent 响应中是否包含 PRD 内容，自动提取为资产
   */
  private async tryExtractPrd(sdkSessionId: string, responseText: string, onEvent: SseEventCallback): Promise<void> {
    const prdMarkers = [
      '# PRD',
      '# 产品需求',
      '## 需求',
      '# Product Requirements',
      '产品需求文档',
      '## 功能需求',
      '## 非功能需求',
    ];
    const hasPrdMarker = prdMarkers.some((m) => responseText.includes(m));
    if (!hasPrdMarker) return;

    try {
      let title = '产品需求文档';
      const h1Match = responseText.match(/^# (.+)$/m);
      if (h1Match) {
        title = h1Match[1].trim();
      }

      const session = await this.sessionService.getBySdkSessionId(sdkSessionId);

      const asset = await this.assetService.create({
        sessionId: session.id,
        type: 'prd',
        title,
        content: responseText,
      });

      this.logger.log(`Auto-extracted PRD asset ${asset.id} for session ${sdkSessionId}`);

      onEvent({
        type: SseEventType.AssetReady,
        data: { assetId: asset.id, title: asset.title },
      });
    } catch (error) {
      this.logger.warn(`Failed to extract PRD for session ${sdkSessionId}: ${(error as Error).message}`);
    }
  }

  /**
   * SDK 消息 → SSE 事件映射
   *
   * @param msg SDK 原始消息
   * @param tracker 内容追踪器，在 mapper 和 main loop 之间传递块级状态
   */
  private mapSdkMessageToSseEvents(msg: SDKMessage, tracker: ContentTracker): SseEvent[] {
    const events: SseEvent[] = [];
    const { blockStack } = tracker;

    if (msg.type === 'stream_event') {
      const event = msg.event;

      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'text') {
            // 延迟 MessageStart——等到第一个真实 text_delta 到达时再创建气泡，
            // 避免空白/零长度 text block 产生空的助理气泡
            if (block.text && block.text.trim().length > 0) {
              // 某些 SDK 版本在 content_block_start 中直接包含文本
              events.push({ type: SseEventType.MessageStart, data: { content: block.text } });
              blockStack.push('text_started');
            } else {
              blockStack.push('text_pending');
            }
          } else if (block.type === 'thinking') {
            blockStack.push('thinking');
            tracker.resetThinkingText();
            events.push({
              type: SseEventType.ToolInProgress,
              data: { status: '思考中...' },
            });
          } else if (block.type === 'tool_use') {
            blockStack.push('tool_use');
            const toolName = block.name || 'unknown';
            events.push({
              type: SseEventType.ToolInProgress,
              data: { status: `正在调用工具: ${toolName}...` },
            });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            // 跳过空白/零长度 text_delta——避免用空白内容创建气泡
            if (!delta.text || delta.text.trim().length === 0) {
              break;
            }
            // text_pending → 首个真实 text delta，发出 MessageStart 创建气泡
            if (blockStack.length > 0 && blockStack[blockStack.length - 1] === 'text_pending') {
              blockStack[blockStack.length - 1] = 'text_started';
              events.push({ type: SseEventType.MessageStart, data: { content: '' } });
            }
            events.push({ type: SseEventType.MessageDelta, data: { content: delta.text } });
          } else if (delta.type === 'thinking_delta') {
            // 累积 thinking 内容到 tracker
            if (delta.thinking) {
              tracker.appendThinkingText(delta.thinking);
            }
            // 也转发到前端，让用户可以看到思考过程
            if (delta.thinking && delta.thinking.trim().length > 0) {
              events.push({ type: SseEventType.MessageDelta, data: { content: delta.thinking } });
            }
          } else if (delta.type === 'signature_delta') {
            // 签名数据，仅用于验证思考内容完整性，不展示
          } else if (delta.type === 'input_json_delta') {
            // 工具调用 JSON 增量，暂不处理
          }
          break;
        }
        case 'content_block_stop': {
          const prev = blockStack.pop();
          if (prev === 'text_started') {
            // 有内容的 text block 结束 → 标记对应气泡为 Complete
            events.push({ type: SseEventType.MessageDone, data: {} });
          } else if (prev === 'tool_use') {
            events.push({ type: SseEventType.ToolComplete, data: {} });
          } else if (prev === 'thinking') {
            // 将完整 thinking 内容传递给 main loop（通过 tracker）
            tracker.markThinkingComplete();
            events.push({
              type: SseEventType.ToolInProgress,
              data: { status: '思考结束，正在生成回复...' },
            });
          }
          // prev === 'text_pending'：空 text block（无实际内容），直接忽略
          break;
        }
        case 'message_start':
        case 'message_delta':
          // 暂不需要处理
          break;
        case 'message_stop': {
          blockStack.length = 0;
          events.push({ type: SseEventType.MessageComplete, data: {} });
          break;
        }
      }
    } else if (msg.type === 'assistant') {
      const blocks = msg.message?.content;
      const hasText = Array.isArray(blocks) && blocks.some((b) => b.type === 'text' && b.text);
      if (hasText) {
        events.push({ type: SseEventType.MessageDone, data: {} });
      }
    } else if (msg.type === 'prompt_suggestion') {
      const suggestion = (msg as SDKPromptSuggestionMessage).suggestion;
      if (suggestion) {
        events.push({
          type: SseEventType.ToolOptions,
          data: { options: [suggestion] },
        });
      }
    }

    return events;
  }

  /**
   * 获取会话历史消息（通过 SDK）
   */
  async getSessionMessages(sdkSessionId: string) {
    return this.agentService.getSessionMessages(sdkSessionId);
  }
}
