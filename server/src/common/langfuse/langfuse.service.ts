import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LangfuseTraceClient } from 'langfuse';
import { Langfuse } from 'langfuse';
import { Logger } from 'nestjs-pino';

/**
 * Langfuse 服务
 *
 * 封装 langfuse-node SDK，为 Claude Agent SDK 调用提供调用链追踪。
 * 延迟初始化：LANGFUSE_BASE_URL 未设置时跳过，不阻塞主流程。
 * 所有方法 try/catch 静默降级。
 */
@Injectable()
export class LangfuseService implements OnModuleInit {
  private client: Langfuse | null = null;
  private available = false;

  /** 活跃的 Trace 引用，key = SDK session UUID */
  private readonly traces = new Map<string, LangfuseTraceClient>();

  /** 待写入的 Token 用量（流处理过程中填充，SessionEnd 最终消费） */
  private readonly pendingUsage = new Map<string, { inputTokens?: number; outputTokens?: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    const host = this.configService.get<string>('LANGFUSE_BASE_URL');
    if (!host) {
      this.logger.warn('Langfuse: LANGFUSE_BASE_URL 未配置，跳过初始化');
      return;
    }

    const publicKey = this.configService.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.configService.get<string>('LANGFUSE_SECRET_KEY');
    if (!publicKey || !secretKey) {
      this.logger.warn('Langfuse: LANGFUSE_PUBLIC_KEY 或 LANGFUSE_SECRET_KEY 未配置，跳过初始化');
      return;
    }

    try {
      this.client = new Langfuse({
        publicKey,
        secretKey,
        baseUrl: host,
      });
      this.available = true;
      this.logger.log(`Langfuse 已初始化，地址: ${host}`);
    } catch (err) {
      this.logger.warn(`Langfuse: 初始化失败 — ${(err as Error).message}`);
    }
  }

  /** Langfuse 是否可用 */
  get isAvailable(): boolean {
    return this.available;
  }

  /**
   * 为一次 Agent query 创建 Traces
   * @param sdkSessionId SDK 会话 ID
   * @param projectId 可选项目 ID，用于 tags
   * @param model 可选模型名，用于 tags
   * @returns traceId，失败返回 null
   */
  createTrace(sdkSessionId: string, projectId?: string, model?: string): string | null {
    if (!this.available || !this.client) return null;

    try {
      const tags = ['oceanus'];
      if (projectId) tags.push(`project:${projectId}`);
      if (model) tags.push(`model:${model}`);

      const trace = this.client.trace({
        name: 'oceanus-agent-query',
        sessionId: sdkSessionId,
        tags,
      });
      this.traces.set(sdkSessionId, trace);
      return trace.id;
    } catch (err) {
      this.logger.warn(`Langfuse: createTrace 失败 — ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * 为工具调用创建 Span
   */
  createToolSpan(sdkSessionId: string, toolName: string, input?: unknown, output?: unknown, durationMs?: number): void {
    if (!this.available) return;

    try {
      const trace = this.traces.get(sdkSessionId);
      if (!trace) return;

      trace.span({
        name: `tool-${toolName}`,
        input: input ?? undefined,
        output: output ?? undefined,
        startTime: durationMs ? new Date(Date.now() - durationMs) : undefined,
      });
    } catch (err) {
      this.logger.warn(`Langfuse: createToolSpan 失败 — ${(err as Error).message}`);
    }
  }

  /**
   * 标记工具调用为错误
   */
  markToolError(sdkSessionId: string, toolName: string, error: unknown): void {
    if (!this.available) return;

    try {
      const trace = this.traces.get(sdkSessionId);
      if (!trace) return;

      trace.span({
        name: `tool-${toolName}-error`,
        input: undefined,
        output: { error: String(error) },
        level: 'ERROR',
      });
    } catch (err) {
      this.logger.warn(`Langfuse: markToolError 失败 — ${(err as Error).message}`);
    }
  }

  /**
   * 记录 LLM 生成内容（Generation）
   *
   * 每次 Agent 完成一轮回复后调用，将模型的文本输出、输入和 Token 用量
   * 作为 Generation 上报到当前 Trace 下。
   */
  recordGeneration(
    sdkSessionId: string,
    input: string,
    output: string,
    usage?: { inputTokens?: number; outputTokens?: number },
  ): void {
    if (!this.available) return;

    try {
      let trace = this.traces.get(sdkSessionId);
      if (!trace) {
        // 多轮对话的续传消息：Trace 可能在首轮已经创建，或已被刷新清理。
        // 如果没有找到，重新创建一个。
        trace = this.client!.trace({
          name: 'oceanus-agent-query',
          sessionId: sdkSessionId,
          tags: ['oceanus'],
        });
        this.traces.set(sdkSessionId, trace);
      }

      const model = this.configService.get<string>('AGENT_MODEL') || 'claude';

      trace.generation({
        name: 'agent-response',
        model,
        input,
        output,
        ...(usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)
          ? {
              usage: {
                input: usage.inputTokens ?? 0,
                output: usage.outputTokens ?? 0,
                unit: 'TOKENS' as const,
              },
            }
          : {}),
      });
    } catch (err) {
      this.logger.warn(`Langfuse: recordGeneration 失败 — ${(err as Error).message}`);
    }
  }

  /**
   * 记录模型思考内容（Span）
   *
   * 当 SDK 启用 thinking 时，模型的内部推理过程会作为思考块流式输出。
   * 将其作为 Span 记录在 Trace 下，便于分析模型的决策链路。
   */
  recordThinking(sdkSessionId: string, thinkingContent: string): void {
    if (!this.available) return;
    if (!thinkingContent || thinkingContent.trim().length === 0) return;

    try {
      const trace = this.traces.get(sdkSessionId);
      if (!trace) return;

      // 截取前 200 字符作为 span name
      const preview = thinkingContent.trim().slice(0, 200);
      trace.span({
        name: 'agent-thinking',
        input: preview,
        output: thinkingContent,
        metadata: {
          thinkingLength: thinkingContent.length,
        },
      });
    } catch (err) {
      this.logger.warn(`Langfuse: recordThinking 失败 — ${(err as Error).message}`);
    }
  }

  /**
   * 刷新 Trace 数据到 Langfuse（保留 Trace 以供多轮对话复用）
   */
  async flushTrace(sdkSessionId: string): Promise<void> {
    if (!this.available || !this.client) return;

    try {
      const trace = this.traces.get(sdkSessionId);
      if (!trace) return;
      await this.client.flushAsync();
    } catch (err) {
      this.logger.warn(`Langfuse: flushTrace 失败 — ${(err as Error).message}`);
    }
  }

  /**
   * 结束并清理 Trace（会话销毁时调用）
   * @param sdkSessionId SDK 会话 ID
   */
  async finalizeTrace(sdkSessionId: string): Promise<void> {
    if (!this.available || !this.client) return;

    try {
      const trace = this.traces.get(sdkSessionId);
      if (!trace) return;

      await this.client.flushAsync();
      this.traces.delete(sdkSessionId);
      this.pendingUsage.delete(sdkSessionId);
    } catch (err) {
      this.logger.warn(`Langfuse: finalizeTrace 失败 — ${(err as Error).message}`);
    }
  }
}
