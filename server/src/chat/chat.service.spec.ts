vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ChatService } from './chat.service';
import { AgentService } from '../agent/agent.service';
import { SessionService } from '../session/session.service';
import { AssetService } from '../asset/asset.service';
import { ProjectService } from '../project/project.service';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { SessionLogService } from '../common/logging/session-log.service';
import { RequestQueueService } from '../common/queue/request-queue.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { SkillsProvider } from '../skills/skills-provider.interface';
import { ArchiveService } from '../archive/archive.service';
import { writeFile } from 'node:fs/promises';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('ChatService', () => {
  let service: ChatService;
  let agentService: AgentService;
  let sessionService: SessionService;
  let projectService: ProjectService;

  const TEST_USERNAME = 'admin';
  const TEST_PROJECT = { id: 1, projectName: 'project-a', displayName: '项目A', sessionCount: 0 };
  const TEST_PARTITION = 'project-a/admin';

  const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockAgentService = {
    sendMessage: vi.fn(),
    getSessionMessages: vi.fn(),
    getAgentLimits: vi.fn().mockReturnValue({ maxTurns: 15, maxBudgetUsd: 1.0 }),
  };

  const mockSessionService = {
    getBySdkSessionId: vi.fn(),
    create: vi.fn(),
    updateTitle: vi.fn(),
    touch: vi.fn().mockResolvedValue(undefined),
  };

  const mockProjectService = {
    getById: vi.fn().mockResolvedValue(TEST_PROJECT),
    assertMember: vi.fn(),
  };

  const mockAssetService = {
    create: vi.fn(),
  };

  const mockLangfuseService = {
    isAvailable: true,
    createTrace: vi.fn(),
    createToolSpan: vi.fn(),
    markToolError: vi.fn(),
    recordGeneration: vi.fn(),
    recordThinking: vi.fn(),
    flushTrace: vi.fn().mockResolvedValue(undefined),
    finalizeTrace: vi.fn().mockResolvedValue(undefined),
  };

  const mockSessionLogService = {
    log: vi.fn(),
    closeSession: vi.fn(),
  };

  const mockRequestQueue = {
    enqueue: vi.fn().mockImplementation(async (req: { execute: () => Promise<void> }) => {
      // Execute immediately (simulates direct execution path)
      const executionPromise = req.execute();
      return {
        status: 'executed' as const,
        executionPromise,
      };
    }),
    cancel: vi.fn().mockReturnValue(false),
    getQueuePosition: vi.fn().mockReturnValue(null),
  };

  const mockWorkspace = {
    ensureSessionDir: vi.fn().mockResolvedValue(undefined),
    paths: {
      projectRoot: vi.fn((proj: string) => `/projects/${proj}`),
      sessionDir: vi.fn(
        (proj: string, user: string, sid: string) => `/projects/${proj}/requirements/private/${user}/${sid}`,
      ),
      sharedRoot: vi.fn((proj: string) => `/projects/${proj}/requirements/shared`),
      sharedPrdDir: vi.fn((proj: string) => `/projects/${proj}/requirements/shared/prd`),
      requirementsRoot: vi.fn((proj: string) => `/projects/${proj}/requirements`),
    },
  } as unknown as WorkspaceService;

  const mockSkills = {
    install: vi.fn().mockResolvedValue(undefined),
    isOutdated: vi.fn().mockResolvedValue(false),
  } as unknown as SkillsProvider;

  const mockArchiveService = {
    onPrdExtracted: vi.fn().mockResolvedValue(undefined),
  } as unknown as ArchiveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: Logger, useValue: mockLogger },
        { provide: AgentService, useValue: mockAgentService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: ProjectService, useValue: mockProjectService },
        { provide: AssetService, useValue: mockAssetService },
        { provide: LangfuseService, useValue: mockLangfuseService },
        { provide: SessionLogService, useValue: mockSessionLogService },
        { provide: RequestQueueService, useValue: mockRequestQueue },
        { provide: WorkspaceService, useValue: mockWorkspace },
        { provide: SkillsProvider, useValue: mockSkills },
        { provide: ArchiveService, useValue: mockArchiveService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    agentService = module.get<AgentService>(AgentService);
    sessionService = module.get<SessionService>(SessionService);
    projectService = module.get<ProjectService>(ProjectService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockQueryResult(gen: AsyncGenerator<any>) {
    return {
      stream: gen,
      interrupt: vi.fn(),
    };
  }

  /** 续传场景的会话（含用户名与项目 projectName，用于分区推导） */
  const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    sdkSessionId: 'sdk-uuid',
    title: '新会话',
    username: TEST_USERNAME,
    projectId: TEST_PROJECT.id,
    project: { id: TEST_PROJECT.id, projectName: TEST_PROJECT.projectName, displayName: TEST_PROJECT.displayName },
    ...overrides,
  });

  describe('sendAndStream（首条消息 — 无 sdkSessionId）', () => {
    const SDK_SESSION_ID = 'sdk-uuid-new';

    it('缺少 projectName 时抛 400（新会话首条必传，符合 API Contract）', async () => {
      await expect(
        service.sendAndStream({ content: 'hello', username: TEST_USERNAME, onEvent: vi.fn() }),
      ).rejects.toThrow(BadRequestException);
      expect(agentService.sendMessage).not.toHaveBeenCalled();
    });

    it('非项目成员时抛 404 且不调用 sendMessage', async () => {
      // mockRejectedValueOnce：仅本次调用拒绝，避免污染后续用例（clearAllMocks 不重置实现）
      mockProjectService.getById.mockRejectedValueOnce(new NotFoundException('项目不存在'));

      await expect(
        service.sendAndStream({
          content: 'hello',
          projectName: 'project-a',
          username: TEST_USERNAME,
          onEvent: vi.fn(),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(agentService.sendMessage).not.toHaveBeenCalled();
    });

    it('首条消息应按 (projectName/username) 推导分区并调用 sendMessage 不带 resume', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: SDK_SESSION_ID };
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello' } },
        };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: SDK_SESSION_ID, title: '新会话' });

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hello',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(projectService.getById).toHaveBeenCalledWith('project-a', TEST_USERNAME);
      expect(agentService.sendMessage).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ partitionKey: TEST_PARTITION }),
      );
      expect(agentService.sendMessage).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resume: expect.anything() }),
      );
    });

    it('首条消息：预生成 sessionId → ensureSessionDir → 传 sessionDir/sharedDir/sessionId', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: SDK_SESSION_ID };
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: SDK_SESSION_ID, title: '新会话' });

      await service.sendAndStream({
        content: 'hi',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect(mockWorkspace.ensureSessionDir).toHaveBeenCalledWith(
        'project-a',
        TEST_USERNAME,
        expect.stringMatching(UUID_RE),
      );
      const sendArgs = mockAgentService.sendMessage.mock.calls[0];
      expect(sendArgs[0]).toBe('hi');
      expect(sendArgs[1].sessionDir).toContain('project-a/requirements/private/admin');
      expect(sendArgs[1].sharedDir).toContain('project-a/requirements/shared');
      expect(sendArgs[1].sessionId).toEqual(expect.stringMatching(UUID_RE));
    });

    it('首条消息应从 init 事件捕获 session_id 并创建 Session（记录归属用户）', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: SDK_SESSION_ID };
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello' } },
        };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: SDK_SESSION_ID, title: '新会话' });

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hello',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(sessionService.create).toHaveBeenCalledWith(TEST_PROJECT.id, SDK_SESSION_ID, TEST_USERNAME);
      expect(events.some((e) => e.type === 'session_created')).toBe(true);
      const sessionCreated = events.find((e) => e.type === 'session_created');
      expect(sessionCreated?.data.sdkSessionId).toBe(SDK_SESSION_ID);
    });

    it('首条消息捕获 system/init 后应创建 Langfuse Trace', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: SDK_SESSION_ID };
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      await service.sendAndStream({
        content: 'hello',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect(mockLangfuseService.createTrace).toHaveBeenCalledWith(SDK_SESSION_ID, undefined, undefined);
    });

    it('首条消息 session_id 应在后续消息中传递', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: SDK_SESSION_ID };
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      let capturedSdkSessionId = '';
      await service.sendAndStream({
        content: 'hello',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: (e) => {
          if (e.type === 'session_created') {
            capturedSdkSessionId = e.data.sdkSessionId;
          }
        },
      });

      expect(capturedSdkSessionId).toBe(SDK_SESSION_ID);
    });

    it('流完成后应更新 lastMessageAt（touch）', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: SDK_SESSION_ID };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: SDK_SESSION_ID, title: '新会话' });

      await service.sendAndStream({
        content: 'hello',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect(mockSessionService.touch).toHaveBeenCalledWith(SDK_SESSION_ID);
    });

    it('空消息应抛 400（BadRequestException）', async () => {
      await expect(
        service.sendAndStream({ content: '', username: TEST_USERNAME, projectName: 'project-a', onEvent: vi.fn() }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendAndStream（续传 — 有 sdkSessionId）', () => {
    const SDK_SESSION_ID = 'sdk-uuid-existing';

    it('续传应按会话推导分区并调用 sendMessage 带 resume + partitionKey', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession({ sdkSessionId: SDK_SESSION_ID }));

      const mockGen = (async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '继续' } },
        };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '继续' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      await service.sendAndStream({
        content: '继续说',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect(mockSessionService.getBySdkSessionId).toHaveBeenCalledWith(SDK_SESSION_ID);
      expect(agentService.sendMessage).toHaveBeenCalledWith(
        '继续说',
        expect.objectContaining({ resume: SDK_SESSION_ID, partitionKey: TEST_PARTITION }),
      );
    });

    it('续传不应创建新 session', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession({ sdkSessionId: SDK_SESSION_ID }));

      const mockGen = (async function* () {
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.sendAndStream({
        content: '继续说',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(sessionService.create).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'session_created')).toBe(false);
    });

    it('非所有者续传应抛 404（不泄露会话存在性）', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession({ sdkSessionId: SDK_SESSION_ID }));

      await expect(
        service.sendAndStream({
          content: 'hi',
          sdkSessionId: SDK_SESSION_ID,
          username: 'other',
          onEvent: vi.fn(),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(agentService.sendMessage).not.toHaveBeenCalled();
    });

    it('sessionId 不存在时应抛出错误', async () => {
      mockSessionService.getBySdkSessionId.mockRejectedValue(new NotFoundException('会话不存在'));

      await expect(
        service.sendAndStream({
          content: 'hi',
          sdkSessionId: 'non-existent',
          username: TEST_USERNAME,
          onEvent: vi.fn(),
        }),
      ).rejects.toThrow();
    });
  });

  describe('sendAndStream — SDK 事件映射', () => {
    it('应正确映射 text_delta 事件', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-uuid' };
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '分析' } },
        };
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '需求' } },
        };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '分析需求' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: 'sdk-uuid', title: '新会话' });

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(events.some((e) => e.type === 'message_start')).toBe(true);
      expect(events.some((e) => e.type === 'message_delta')).toBe(true);
      expect(events.some((e) => e.type === 'message_done')).toBe(true);
      expect(events.some((e) => e.type === 'stream_complete')).toBe(true);
    });

    it('SDK tool_use 应映射为 tool_in_progress 事件', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-uuid' };
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'elicit' } },
        };
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: 'sdk-uuid', title: '新会话' });

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(events.some((e) => e.type === 'tool_in_progress')).toBe(true);
    });

    it('SDK 错误时应在 SSE 事件中推送 error', async () => {
      mockAgentService.sendMessage.mockRejectedValue(new Error('SDK 连接失败'));
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hello',
        sdkSessionId: 'sdk-uuid',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(events.some((e) => e.type === 'error')).toBe(true);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('SDK prompt_suggestion 应映射为 tool_options 事件', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-uuid' };
        yield {
          type: 'prompt_suggestion',
          suggestion: '帮我总结一下',
          uuid: 'uuid-1',
          session_id: 'sdk-uuid',
        } as any;
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: 'sdk-uuid', title: '新会话' });

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      const toolOptions = events.find((e) => e.type === 'tool_options');
      expect(toolOptions).toBeDefined();
      expect(toolOptions.data.options).toEqual(['帮我总结一下']);
    });

    it('流完成后应清理 activeQuery 引用', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-uuid' };
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: 'sdk-uuid', title: '新会话' });

      await service.sendAndStream({
        content: 'hi',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect((service as any).activeQueries.has('sdk-uuid')).toBe(false);
    });
  });

  describe('sendAndStream — 限额命中', () => {
    const SDK_SESSION_ID = 'sdk-uuid-limit';

    beforeEach(() => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession({ sdkSessionId: SDK_SESSION_ID }));
    });

    it('达到轮次上限应发 turn_limit_reached 且不重复发 error', async () => {
      const mockGen = (async function* () {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          num_turns: 15,
          total_cost_usd: 0.8,
          usage: {},
          errors: ['Reached maximum number of turns'],
        } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      const limitEvent = events.find((e) => e.type === 'turn_limit_reached');
      expect(limitEvent).toBeDefined();
      expect(limitEvent.data).toEqual({ limit: 15 });
      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(events.some((e) => e.type === 'stream_complete')).toBe(true);
    });

    it('达到预算上限应发 budget_limit_reached 且 data 携带 limit', async () => {
      const mockGen = (async function* () {
        yield {
          type: 'result',
          subtype: 'error_max_budget_usd',
          is_error: true,
          num_turns: 9,
          total_cost_usd: 1.0,
          usage: {},
          errors: ['Reached maximum budget of $1.00'],
        } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      const limitEvent = events.find((e) => e.type === 'budget_limit_reached');
      expect(limitEvent).toBeDefined();
      expect(limitEvent.data).toEqual({ limit: 1.0 });
      expect(events.some((e) => e.type === 'error')).toBe(false);
    });

    it('限额命中应跳过标题更新与 PRD 提取，仍 flush trace 并记日志', async () => {
      const mockGen = (async function* () {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          num_turns: 15,
          total_cost_usd: 0.8,
          usage: {},
          errors: ['Reached maximum number of turns'],
        } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      await service.sendAndStream({
        content: 'hi',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect(mockSessionService.updateTitle).not.toHaveBeenCalled();
      expect(mockAssetService.create).not.toHaveBeenCalled();
      expect(mockLangfuseService.recordGeneration).not.toHaveBeenCalled();
      expect(mockLangfuseService.flushTrace).toHaveBeenCalled();
      expect(mockSessionLogService.log).toHaveBeenCalledWith(
        'default',
        SDK_SESSION_ID,
        'Turn limit reached',
        expect.anything(),
      );
    });

    it('其他错误子类型（error_during_execution）应照常发 error 事件', async () => {
      const mockGen = (async function* () {
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 3,
          total_cost_usd: 0.1,
          usage: {},
          errors: ['Tool execution failed'],
        } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].data.message).toContain('Tool execution failed');
    });

    it('限额命中后后处理抛错应记录 warn 且不重复发 error', async () => {
      const mockGen = (async function* () {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          num_turns: 15,
          total_cost_usd: 0.8,
          usage: {},
          errors: ['Reached maximum number of turns'],
        } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));
      mockLangfuseService.flushTrace.mockRejectedValueOnce(new Error('langfuse down'));

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hi',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('限额应在 query 开始时解析一次（成功流也不重复解析 env）', async () => {
      const mockGen = (async function* () {
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      await service.sendAndStream({
        content: 'hi',
        sdkSessionId: SDK_SESSION_ID,
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      expect(mockAgentService.getAgentLimits).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmAndStream', () => {
    it('confirm 应校验所有者并调用 sendMessage 带 resume + partitionKey', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());

      const mockGen = (async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '好的' } },
        };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '好的' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.confirmAndStream({
        sdkSessionId: 'sdk-uuid',
        confirmOption: '方案A',
        username: TEST_USERNAME,
        onEvent: (e) => events.push(e),
      });

      expect(agentService.sendMessage).toHaveBeenCalledWith(
        '方案A',
        expect.objectContaining({ resume: 'sdk-uuid', partitionKey: TEST_PARTITION }),
      );
      expect(events.some((e) => e.type === 'confirm_accepted')).toBe(true);
      expect(events.some((e) => e.type === 'stream_complete')).toBe(true);
    });

    it('confirm 非所有者应抛 404 且不发 confirm_accepted', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());

      const events: any[] = [];
      await expect(
        service.confirmAndStream({
          sdkSessionId: 'sdk-uuid',
          confirmOption: '方案A',
          username: 'other',
          onEvent: (e) => events.push(e),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(events.some((e) => e.type === 'confirm_accepted')).toBe(false);
      expect(agentService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendAndStream — model 透传', () => {
    const genText = async function* () {
      yield {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hi' } },
      };
    };

    it('首条消息带 model 时传给 sendMessage 第二参数 { model, partitionKey }', async () => {
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(genText()));

      await service.sendAndStream({
        content: 'hello',
        projectName: 'project-a',
        username: TEST_USERNAME,
        model: 'kimi',
        onEvent: vi.fn(),
      });

      expect(agentService.sendMessage).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ model: 'kimi', partitionKey: TEST_PARTITION }),
      );
    });

    it('续传带 model 时传给 sendMessage { resume, model, partitionKey }', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(genText()));

      await service.sendAndStream({
        content: 'hello',
        sdkSessionId: 'sdk-uuid',
        username: TEST_USERNAME,
        model: 'kimi',
        onEvent: vi.fn(),
      });

      expect(agentService.sendMessage).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ resume: 'sdk-uuid', model: 'kimi', partitionKey: TEST_PARTITION }),
      );
    });

    it('confirm 带 model 时透传给 sendAndStream → sendMessage', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(genText()));

      await service.confirmAndStream({
        sdkSessionId: 'sdk-uuid',
        confirmOption: '方案A',
        username: TEST_USERNAME,
        model: 'kimi',
        onEvent: vi.fn(),
      });

      expect(agentService.sendMessage).toHaveBeenCalledWith(
        '方案A',
        expect.objectContaining({ resume: 'sdk-uuid', model: 'kimi', partitionKey: TEST_PARTITION }),
      );
    });
  });

  describe('tryExtractPrd（PRD 落盘与归档触发）', () => {
    it('落盘会话目录并触发归档', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        project: { projectName: 'proj' },
        username: 'alice',
      } as never);
      mockAssetService.create.mockResolvedValue({ id: 9, title: 'T' } as never);

      const onEvent = vi.fn();
      await (
        service as unknown as { tryExtractPrd: (s: string, r: string, e: (ev: unknown) => void) => Promise<void> }
      ).tryExtractPrd('s1', '# PRD\n内容', onEvent);

      expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
        expect.stringContaining('s1'),
        expect.stringContaining('# PRD'),
        'utf8',
      );
      expect(mockArchiveService.onPrdExtracted).toHaveBeenCalledWith('s1');
    });

    it('无 PRD 标记时不落盘也不触发归档', async () => {
      const onEvent = vi.fn();
      await (
        service as unknown as { tryExtractPrd: (s: string, r: string, e: (ev: unknown) => void) => Promise<void> }
      ).tryExtractPrd('s1', '只是一段普通回复', onEvent);

      expect(mockAssetService.create).not.toHaveBeenCalled();
      expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
      expect(mockArchiveService.onPrdExtracted).not.toHaveBeenCalled();
    });
  });

  describe('cancelResponse', () => {
    it('无活跃 query 时不抛异常', async () => {
      await expect(service.cancelResponse('non-existent')).resolves.toBeUndefined();
    });

    it('应调用 query.interrupt()', async () => {
      const interrupt = vi.fn();
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-uuid-cancel' };
        await new Promise(() => {});
      })();
      // 显式注入 interrupt，使 cancelResponse 能拿到同一个引用
      mockAgentService.sendMessage.mockResolvedValue({ stream: mockGen, interrupt });
      mockSessionService.create.mockResolvedValue({ id: 1, sdkSessionId: 'sdk-uuid-cancel', title: '新会话' });

      void service.sendAndStream({
        content: 'hi',
        projectName: 'project-a',
        username: TEST_USERNAME,
        onEvent: vi.fn(),
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.cancelResponse('sdk-uuid-cancel');

      expect(interrupt).toHaveBeenCalled();
    });
  });

  describe('getSessionMessages', () => {
    it('应校验所有者并按分区委托给 AgentService', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());
      mockAgentService.getSessionMessages.mockResolvedValue([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ]);

      const result = await service.getSessionMessages('sdk-uuid', TEST_USERNAME);

      expect(result).toHaveLength(1);
      expect(agentService.getSessionMessages).toHaveBeenCalledWith('sdk-uuid', TEST_PARTITION);
    });

    it('非所有者读取历史应抛 404', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue(makeSession());

      await expect(service.getSessionMessages('sdk-uuid', 'other')).rejects.toThrow(NotFoundException);
      expect(agentService.getSessionMessages).not.toHaveBeenCalled();
    });
  });
});
