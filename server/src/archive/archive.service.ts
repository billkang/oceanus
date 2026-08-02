import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { isWithinLexical } from '../common/path-is-within';

/** 单个会话的去抖状态：最近一次 PRD content 与连续稳定轮数 */
interface DebounceState {
  lastContent: string;
  stableRounds: number;
}

/**
 * 归档合并服务
 *
 * 会话 PRD 落库（Asset type='prd'）后触发归档：按（项目 × 功能域）将多个会话 PRD
 * 经 LLM 合并为一个聚合文档（index.md），写入项目共享需求区的 PRD 目录。
 *
 * 并发控制：
 * - 去抖（debounce）：同一会话连续 N 轮 PRD 内容无变化才触发合并，避免流式写入
 *   中间态反复触发；
 * - 同域串行（domain mutex）：同一（项目 × 域）的合并串行执行，防止聚合文档写
 *   冲突；不同域可并行；
 * - 有界重试：合并失败按指数退避（1s / 2s）最多重试 3 次。
 */
@Injectable()
export class ArchiveService {
  private readonly debounceRounds: number;
  private readonly maxTurns: number;
  private readonly maxBudgetUsd: number;
  private readonly debounce = new Map<string, DebounceState>();
  private readonly domainLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    configService: ConfigService,
    private readonly logger: Logger,
  ) {
    this.debounceRounds = num(configService.get('ARCHIVE_DEBOUNCE_ROUNDS'), 3);
    this.maxTurns = num(configService.get('ARCHIVE_MERGE_MAX_TURNS'), 5);
    this.maxBudgetUsd = num(configService.get('ARCHIVE_MERGE_MAX_BUDGET_USD'), 0.2);
  }

  /** PRD 提取完成回调：读取会话最新 PRD，按内容稳定性去抖调度合并 */
  async onPrdExtracted(sessionId: string): Promise<void> {
    const asset = await this.prisma.asset.findFirst({
      where: { session: { sdkSessionId: sessionId }, type: 'prd', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!asset) return;

    const st = this.debounce.get(sessionId);
    if (!st || st.lastContent !== asset.content) {
      this.debounce.set(sessionId, { lastContent: asset.content, stableRounds: 1 });
      return;
    }
    st.stableRounds += 1;
    if (st.stableRounds < this.debounceRounds) return;

    // 稳定轮数达标 → 触发（触发后计数重置，防止重复合并）
    st.stableRounds = 0;
    const session = await this.prisma.session.findFirst({
      where: { sdkSessionId: sessionId },
      include: { project: true },
    });
    if (!session || session.deletedAt != null) return;
    const projectName = session.project.projectName;
    const domain = await this.resolveDomain(projectName, asset.title, asset.content);
    await this.mergeLocked(projectName, domain, asset.content).catch((e: Error) => {
      this.logger.error(`归档合并失败: ${e.message}`);
    });
  }

  /** 决定 PRD 归属的功能域（v1 简化：无既有域建「默认域」，否则复用首个域目录） */
  private async resolveDomain(projectName: string, _title: string, _content: string): Promise<string> {
    const prdRoot = this.workspace.paths.sharedPrdDir(projectName);
    let domains: string[] = [];
    try {
      domains = (await fsp.readdir(prdRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      domains = [];
    }
    if (domains.length === 0) return '默认域';
    return domains[0];
  }

  /** 同域串行：同一（项目 × 域）的合并按链条排队，不同域互不阻塞 */
  private mergeLocked(projectName: string, domain: string, prdContent: string): Promise<void> {
    const key = path.join(this.workspace.paths.sharedPrdDir(projectName), domain);
    // 前一次失败不得传染：catch 消化 rejection，让链条继续执行后续排队任务
    const prev = (this.domainLocks.get(key) ?? Promise.resolve()).catch(() => undefined);
    const next = prev.then(() => this.runMergeWithRetry(projectName, domain, prdContent));
    this.domainLocks.set(key, next);
    return next.finally(() => {
      if (this.domainLocks.get(key) === next) this.domainLocks.delete(key);
    });
  }

  /** 有界重试：指数退避（1s / 2s）最多 3 次，仍失败则抛出 */
  private async runMergeWithRetry(projectName: string, domain: string, prdContent: string): Promise<void> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        return await this.executeMerge(projectName, domain, prdContent);
      } catch (e) {
        attempt += 1;
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  /**
   * 独立 LLM 合并调用：读取既有聚合文档，由模型语义合并后写回 index.md。
   *
   * 运行隔离：cwd 限定共享 PRD 目录（不暴露含 private/ 的 requirementsRoot），
   * config 目录独立（隔离宿主机全局配置），读写白名单 hooks 把模型文件访问锁在
   * 共享需求区（写仅 sharedPrdDir、读仅 sharedRoot）。
   */
  private async executeMerge(projectName: string, domain: string, prdContent: string): Promise<void> {
    const sharedPrdDir = this.workspace.paths.sharedPrdDir(projectName);
    const sharedRoot = this.workspace.paths.sharedRoot(projectName);
    const aggregateFile = path.join(sharedPrdDir, domain, 'index.md');
    await fsp.mkdir(path.dirname(aggregateFile), { recursive: true });
    let existing = '';
    try {
      existing = await fsp.readFile(aggregateFile, 'utf8');
    } catch {
      existing = '';
    }

    // 本地会话副本指向临时目录即弃，避免污染宿主机全局配置
    const configDir = path.join(os.tmpdir(), 'oceanus-archive-config', projectName, domain, Date.now().toString());
    const q = query({
      prompt: `你是 Oceanus 需求归档合并器。请将新的 PRD 内容语义合并到既有的功能域聚合文档中。

【既有聚合文档】（可能为空）：
${existing || '(空)'}

【新的会话 PRD】：
${prdContent}

要求：
1. 完整保留既有聚合文档中的既有内容，不得丢失用户历史信息。
2. 将新 PRD 的用户信息整理后合并进去，去重、归类、保持 Markdown 结构。
3. 结果只写回聚合文档文件（用 Write 工具），不要输出额外解释。
目标文件：${aggregateFile}`,
      options: {
        tools: ['Read', 'Write', 'Glob', 'Grep'],
        cwd: sharedPrdDir,
        additionalDirectories: [sharedRoot],
        skills: [],
        settingSources: [],
        maxTurns: this.maxTurns,
        maxBudgetUsd: this.maxBudgetUsd,
        model: 'default',
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        includePartialMessages: true,
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                async (input: HookInput) => {
                  if (input.hook_event_name !== 'PreToolUse') return { continue: true };
                  const target = (input.tool_input as { file_path?: string } | undefined)?.file_path;
                  if (
                    typeof target !== 'string' ||
                    !isWithinLexical(sharedPrdDir, path.resolve(input.cwd ?? sharedPrdDir, target))
                  ) {
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        permissionDecision: 'deny' as const,
                        permissionDecisionReason: `写操作目标超出共享 PRD 目录: ${target ?? '(无路径)'}`,
                      },
                    };
                  }
                  return { continue: true };
                },
              ],
            },
            {
              matcher: 'Read',
              hooks: [
                async (input: HookInput) => {
                  if (input.hook_event_name !== 'PreToolUse') return { continue: true };
                  const target = (input.tool_input as { file_path?: string } | undefined)?.file_path;
                  if (typeof target !== 'string') return { continue: true };
                  const abs = path.resolve(input.cwd ?? sharedPrdDir, target);
                  if (isWithinLexical(sharedRoot, abs)) return { continue: true };
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason: `读操作目标越出共享需求区: ${target}`,
                    },
                  };
                },
              ],
            },
          ],
        },
      },
    });
    for await (const msg of q) {
      if (msg.type === 'result' && (msg as { subtype?: string }).subtype === 'success') return;
      if (msg.type === 'result' && (msg as { is_error?: boolean }).is_error) {
        throw new Error(`合并调用失败: ${JSON.stringify((msg as { errors?: unknown }).errors)}`);
      }
    }
  }
}

/** 解析正数配置（无效值回退默认，永不进入无限/零状态） */
function num(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
