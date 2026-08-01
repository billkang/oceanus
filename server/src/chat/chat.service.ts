import type {
  SDKMessage,
  SDKPromptSuggestionMessage,
  SDKResultError,
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
import { RequestQueueService } from '../common/queue/request-queue.service';

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
    private readonly requestQueue: RequestQueueService,
  ) {}

  /**
   * 发送消息并处理 SDK 事件流
   *
   * 无 sdkSessionId = 首条消息 → 自动捕获 system/init → 懒创建 Session
   * 有 sdkSessionId = 续传 → resume: sessionId
   *
   * 请求通过 RequestQueue 分发：并发未满时直接执行，超限时排队等待。
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

    // 将完整的流式处理逻辑封装为可入队的执行函数
    const executeStream = async (): Promise<void> => {
      // 累加响应文本（用于 PRD 提取和标题生成）
      let responseText = '';
      let tokenUsage: { inputTokens?: number; outputTokens?: number } | undefined;
      /** 限额命中标志：'turns' | 'budget' | null */
      let limitHit: 'turns' | 'budget' | null = null;
      /** 是否已显式发送 error 事件（用于抑制 SDK throw 路径的重复 error） */
      let errorEmitted = false;
      /** 本次 query 生效的限额（开始时解析一次，命中时复用，避免重复读 env） */
      const limits = this.agentService.getAgentLimits();

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

          // 处理 result 错误消息：限额命中发专用事件；其他错误子类型按通用 error 处理
          if (msg.type === 'result') {
            const resultMsg = msg as SDKResultError;
            const isTurnLimit = resultMsg.subtype === 'error_max_turns';
            const isBudgetLimit = resultMsg.subtype === 'error_max_budget_usd';

            // 命中轮次 / 预算上限：发专用事件 + 记录日志 + 置 flag 后受控结束
            if (isTurnLimit || isBudgetLimit) {
              const limit = isTurnLimit ? limits.maxTurns : limits.maxBudgetUsd;

              onEvent({
                type: isTurnLimit ? SseEventType.TurnLimitReached : SseEventType.BudgetLimitReached,
                data: { limit },
              });

              if (capturedSdkSessionId) {
                this.sessionLogService.log(
                  'default',
                  capturedSdkSessionId,
                  isTurnLimit ? 'Turn limit reached' : 'Budget limit reached',
                  { limit },
                );
              }

              limitHit = isTurnLimit ? 'turns' : 'budget';
              break;
            }

            // 其他错误子类型（error_during_execution 等）：显式发 error 事件，避免依赖 SDK throw 路径
            if (resultMsg.is_error) {
              const errMsg = resultMsg.errors?.[0] ?? 'Agent 执行失败';
              onEvent({ type: SseEventType.Error, data: { message: errMsg } });
              if (capturedSdkSessionId) {
                this.sessionLogService.log('default', capturedSdkSessionId, 'Stream error', { error: errMsg });
              }
              errorEmitted = true;
              break;
            }
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
          const round = (this.messageRoundCount.get(finalSessionId) ?? 0) + 1;
          this.messageRoundCount.set(finalSessionId, round);

          if (!limitHit && responseText.trim().length > 0) {
            this.langfuseService.recordGeneration(finalSessionId, content, responseText, tokenUsage);
          }

          await this.langfuseService.flushTrace(finalSessionId);

          // 限额命中 / 已发 error 后跳过标题更新与 PRD 提取
          if (!limitHit && !errorEmitted) {
            await this.afterStreamComplete(finalSessionId, onEvent, responseText);
          }
        }

        onEvent({ type: SseEventType.StreamComplete, data: {} });
      } catch (error) {
        const errMsg = (error as Error).message;
        // 限额命中已发专用事件 / error 已在循环内显式发送：后处理（flushTrace 等）抛错仅记录 WARN，避免重复 error
        if (limitHit || errorEmitted) {
          this.logger.warn(`Chat stream error suppressed (${limitHit ? 'limit' : 'error already emitted'}): ${errMsg}`);
          return;
        }
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
    };

    // 通过请求队列分发
    const queueResult = await this.requestQueue.enqueue({
      sessionId: capturedSdkSessionId ?? 'new',
      execute: executeStream,
      onEvent: onEvent as unknown as (event: Record<string, unknown>) => void,
      enqueuedAt: Date.now(),
    });

    if (queueResult.status === 'queued') {
      onEvent({
        type: SseEventType.Queued,
        data: { position: queueResult.position, estimatedWait: queueResult.estimatedWait },
      });
    } else if (queueResult.status === 'rejected') {
      onEvent({
        type: SseEventType.Error,
        data: { message: '系统繁忙，请稍后重试' },
      });
      return;
    }

    // 等待流处理完成（队列出队后执行或直接执行）
    await queueResult.executionPromise;
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
    // 先尝试从队列中取消
    const removed = this.requestQueue.cancel(sdkSessionId);
    if (removed) {
      this.logger.debug(`Cancelled queued request for session ${sdkSessionId}`);
      return;
    }

    // 不在队列中，走现有中断逻辑
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
            if (block.text && block.text.trim().length > 0) {
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
            if (!delta.text || delta.text.trim().length === 0) {
              break;
            }
            if (blockStack.length > 0 && blockStack[blockStack.length - 1] === 'text_pending') {
              blockStack[blockStack.length - 1] = 'text_started';
              events.push({ type: SseEventType.MessageStart, data: { content: '' } });
            }
            events.push({ type: SseEventType.MessageDelta, data: { content: delta.text } });
          } else if (delta.type === 'thinking_delta') {
            if (delta.thinking) {
              tracker.appendThinkingText(delta.thinking);
            }
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
            events.push({ type: SseEventType.MessageDone, data: {} });
          } else if (prev === 'tool_use') {
            events.push({ type: SseEventType.ToolComplete, data: {} });
          } else if (prev === 'thinking') {
            tracker.markThinkingComplete();
            events.push({
              type: SseEventType.ToolInProgress,
              data: { status: '思考结束，正在生成回复...' },
            });
          }
          break;
        }
        case 'message_start':
        case 'message_delta':
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
