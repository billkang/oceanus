import { deleteSession, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as path from 'node:path';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { FileSystemSessionStore } from './stores/file-system.store';

/**
 * Agent 服务
 *
 * 封装 Claude Agent SDK，提供 AI 需求讨论能力。
 * 仅负责 SDK query() 的创建和生命周期管理。
 * 会话连续性（首条/续传）通过传入 resume 参数控制。
 */
@Injectable()
export class AgentService {
  private readonly available: boolean;
  private readonly sessionStore: FileSystemSessionStore;

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly langfuseService: LangfuseService,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.available = !!apiKey;
    if (!this.available) {
      this.logger.warn('ANTHROPIC_API_KEY 未配置，AI 功能不可用');
    }

    const storeDir = path.resolve(process.cwd(), 'data', 'sessions');
    this.sessionStore = new FileSystemSessionStore(storeDir);
  }

  /** AI 服务是否已配置 */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * 发送消息并获取 SDK 流式响应
   *
   * @param content - 用户消息内容
   * @param options - resume: SDK 会话 ID（续传时必传，首条不传）
   * @returns stream + interrupt
   */
  async sendMessage(content: string, options?: { resume?: string }) {
    if (!this.available) {
      throw new Error('AI 服务未配置');
    }

    this.logger.debug(`Sending message (resume=${options?.resume ?? 'new session'})`);

    const sessionOptions: Record<string, unknown> = {};
    if (options?.resume) {
      sessionOptions.resume = options.resume;
    }

    const q = query({
      prompt: content,
      options: {
        ...sessionOptions,
        sessionStore: this.sessionStore,
        includePartialMessages: true,
        agent: 'oceanus-tide',
        agents: {
          'oceanus-tide': {
            description: 'Oceanus 需求讨论助手',
            prompt: `你是 Oceanus 需求讨论助手，运行在 Oceanus AI 协作平台（网页版）。

⚠️ 重要环境差异：你在网页聊天环境中运行，不是 Claude Code 终端。
- 不要要求用户执行 /clear 命令（网页中无效）
- 不要要求用户执行任何终端命令（如 /clear, cd 等）
- tide-discuss 提到 "引导 /clear" 时，直接告知用户"我们开始新的需求讨论"，跳过这个步骤
- 所有对话通过网页消息完成，用户只能打字回复

你的核心能力：
- 用户表达需求讨论意图（"我想/需要/做一个/讨论一下..."）时，
  调用 Skill 工具加载 tide-discuss 工作流
- 进入 tide-discuss 后，严格按照其工作流引导用户完成需求收敛
- 项目位于 /Users/billkang/workspace/oceanus，已安装 tide-discuss skill`,
            tools: ['Skill', 'Read', 'Write', 'Bash', 'Grep', 'Glob', 'Edit', 'WebSearch', 'WebFetch'],
          },
        },
        skills: 'all',
        settingSources: ['project'],
        model: 'claude-sonnet-5',
        effort: 'low',
        thinking: { type: 'enabled', budgetTokens: 4000 },
        maxTurns: 20,
        ...this.buildLangfuseHooks(),
      },
    });

    return {
      stream: q,
      interrupt: () => q.interrupt(),
    };
  }

  /**
   * 构建 Langfuse 可观测性 hooks
   *
   * 在 SDK 会话的各个生命周期点创建/更新/销毁 Trace。
   * LangfuseService 可选——LANGFUSE 环境变量未配置时静默跳过。
   */
  private buildLangfuseHooks(): Record<string, unknown> {
    const lf = this.langfuseService;
    if (!lf || !lf.isAvailable) return {};

    return {
      hooks: {
        SessionStart: [{
          hooks: [(input: any) => {
            if (input?.session_id) {
              lf.createTrace(input.session_id);
            }
            return Promise.resolve({ continue: true });
          }],
        }],
        PostToolUse: [{
          hooks: [(input: any) => {
            if (input?.session_id) {
              lf.createToolSpan(
                input.session_id, input.tool_name, input.tool_input,
                input.tool_response, input.duration_ms,
              );
            }
            return Promise.resolve({ continue: true });
          }],
        }],
        PostToolUseFailure: [{
          hooks: [(input: any) => {
            if (input?.session_id) {
              lf.markToolError(input.session_id, input.tool_name, input.error);
            }
            return Promise.resolve({ continue: true });
          }],
        }],
        SessionEnd: [{
          hooks: [(input: any) => {
            if (input?.session_id) {
              // 只刷新数据到 Langfuse，不清理 Trace，以支持多轮对话续传
              return lf.flushTrace(input.session_id).then(() => ({ continue: true }));
            }
            return Promise.resolve({ continue: true });
          }],
        }],
      },
    };
  }

  /**
   * 获取会话历史消息
   */
  async getSessionMessages(sessionId: string) {
    return getSessionMessages(sessionId, {
      sessionStore: this.sessionStore,
    });
  }

  /**
   * 销毁 SDK 会话
   */
  async destroyAgent(sessionId: string) {
    this.logger.debug(`Destroying agent session ${sessionId}`);
    await deleteSession(sessionId, {
      sessionStore: this.sessionStore,
    });
  }
}
