import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  SessionEndHookInput,
  SessionStartHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { deleteSession, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as path from 'node:path';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { KeyPoolService } from '../common/key-pool/key-pool.service';
import { ModelRegistryService } from '../common/model-registry/model-registry.service';
import { FileSystemSessionStore } from './stores/file-system.store';

/**
 * Agent 服务
 *
 * 封装 Claude Agent SDK，提供 AI 需求讨论能力。
 * 仅负责 SDK query() 的创建和生命周期管理。
 * 会话连续性（首条/续传）通过传入 resume 参数控制。
 *
 * 模型选择通过 ModelRegistryService：每次调用按所选 provider 解析
 * modelId 与 Key，并经由 query() 的 env 选项逐调用注入 provider 级
 * 环境变量（ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / ANTHROPIC_SMALL_FAST_MODEL），
 * 不再突变全局 process.env，消除并发竞态。
 */
@Injectable()
export class AgentService {
  /** 轮次 / 预算上限默认值（无效配置一律回退） */
  private static readonly DEFAULT_MAX_TURNS = 15;
  private static readonly DEFAULT_MAX_BUDGET_USD = 1.0;

  private readonly sessionStore: FileSystemSessionStore;

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly langfuseService: LangfuseService,
    private readonly keyPool: KeyPoolService,
    private readonly modelRegistry: ModelRegistryService,
  ) {
    const storeDir = path.resolve(process.cwd(), 'data', 'sessions');
    this.sessionStore = new FileSystemSessionStore(storeDir);
  }

  /** AI 服务是否可用（委托注册表：注册表有效 且 默认 provider Key 可解析） */
  isAvailable(): boolean {
    return this.modelRegistry.isAvailable();
  }

  /**
   * 解析环境变量上限值
   * 未配置 / 空值：静默回退默认（正常状态）
   * 非数字 / 0 / 负数（integer=true 时含非整数）：WARN 提示配置非法后回退默认（永不进入无限状态）
   */
  private parseLimit(raw: string | undefined, fallback: number, label: string, integer = false): number {
    if (raw === undefined || raw.trim().length === 0) {
      return fallback;
    }
    const n = Number(raw);
    const valid = Number.isFinite(n) && n > 0 && (!integer || Number.isInteger(n));
    if (valid) {
      return n;
    }
    this.logger.warn(`${label} 配置值非法（${raw}），使用默认值 ${fallback}`);
    return fallback;
  }

  /** 解析生效的轮次 / 预算上限（每次 query 调用，全局默认） */
  private resolveAgentLimits(): { maxTurns: number; maxBudgetUsd: number } {
    return {
      maxTurns: this.parseLimit(
        this.configService.get<string>('AGENT_MAX_TURNS'),
        AgentService.DEFAULT_MAX_TURNS,
        'AGENT_MAX_TURNS',
        true,
      ),
      maxBudgetUsd: this.parseLimit(
        this.configService.get<string>('AGENT_MAX_BUDGET_USD'),
        AgentService.DEFAULT_MAX_BUDGET_USD,
        'AGENT_MAX_BUDGET_USD',
      ),
    };
  }

  /** 当前生效的轮次 / 预算上限（供 ChatService 命中限额时取 limit 值） */
  getAgentLimits(): { maxTurns: number; maxBudgetUsd: number } {
    return this.resolveAgentLimits();
  }

  /**
   * 发送消息并获取 SDK 流式响应
   *
   * @param content - 用户消息内容
   * @param options - resume: SDK 会话 ID（续传时必传，首条不传）；model: provider 逻辑名（缺省用默认 provider）
   * @returns stream + interrupt
   */
  async sendMessage(content: string, options?: { resume?: string; model?: string }) {
    if (!this.isAvailable()) {
      throw new Error('AI 服务未配置');
    }

    // 解析所选 provider（含 modelId 与 Key）；未知/不可用抛 400
    const provider = await this.modelRegistry.resolveProvider(options?.model);
    this.logger.debug(`Sending message (resume=${options?.resume ?? 'new session'}, model=${provider.name})`);

    const sessionOptions: Record<string, unknown> = {};
    if (options?.resume) {
      sessionOptions.resume = options.resume;
    }

    try {
      const { maxTurns, maxBudgetUsd } = this.resolveAgentLimits();

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
          model: provider.modelId,
          env: {
            ...process.env,
            ANTHROPIC_BASE_URL: provider.baseUrl,
            ANTHROPIC_API_KEY: provider.apiKey,
            ANTHROPIC_SMALL_FAST_MODEL: provider.smallFastModel,
          },
          effort: 'low',
          thinking: { type: 'enabled', budgetTokens: 4000 },
          maxTurns,
          maxBudgetUsd,
          ...this.buildLangfuseHooks(provider.modelId),
        },
      });

      return {
        stream: q,
        interrupt: () => q.interrupt(),
      };
    } catch (err) {
      // 仅 keyPool 来源的 Key 标记故障（单 Key provider 无轮换语义）
      if (provider.keySource === 'pool') {
        this.keyPool.markFailure(provider.apiKey).catch((e) => {
          this.logger.error(`Failed to mark key failure: ${e}`);
        });
      }
      throw err;
    }
  }

  /**
   * 构建 Langfuse 可观测性 hooks
   * @param model 本次 query 所选 provider 的 modelId，用于 trace 标记
   */
  private buildLangfuseHooks(model: string): Record<string, unknown> {
    const lf = this.langfuseService;
    if (!lf || !lf.isAvailable) return {};

    return {
      hooks: {
        SessionStart: [
          {
            hooks: [
              (input: SessionStartHookInput) => {
                if (input?.session_id) {
                  lf.createTrace(input.session_id, undefined, model);
                }
                return Promise.resolve({ continue: true });
              },
            ],
          },
        ],
        PostToolUse: [
          {
            hooks: [
              (input: PostToolUseHookInput) => {
                if (input?.session_id) {
                  lf.createToolSpan(
                    input.session_id,
                    input.tool_name,
                    input.tool_input,
                    input.tool_response,
                    input.duration_ms,
                  );
                }
                return Promise.resolve({ continue: true });
              },
            ],
          },
        ],
        PostToolUseFailure: [
          {
            hooks: [
              (input: PostToolUseFailureHookInput) => {
                if (input?.session_id) {
                  lf.markToolError(input.session_id, input.tool_name, input.error);
                }
                return Promise.resolve({ continue: true });
              },
            ],
          },
        ],
        SessionEnd: [
          {
            hooks: [
              (input: SessionEndHookInput) => {
                if (input?.session_id) {
                  return lf.flushTrace(input.session_id).then(() => ({ continue: true }));
                }
                return Promise.resolve({ continue: true });
              },
            ],
          },
        ],
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
