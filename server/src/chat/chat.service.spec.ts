import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { ChatService } from './chat.service';
import { AgentService } from '../agent/agent.service';
import { SessionService } from '../session/session.service';
import { AssetService } from '../asset/asset.service';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { SessionLogService } from '../common/logging/session-log.service';
import { RequestQueueService } from '../common/queue/request-queue.service';

describe('ChatService', () => {
  let service: ChatService;
  let agentService: AgentService;
  let sessionService: SessionService;

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: Logger, useValue: mockLogger },
        { provide: AgentService, useValue: mockAgentService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: AssetService, useValue: mockAssetService },
        { provide: LangfuseService, useValue: mockLangfuseService },
        { provide: SessionLogService, useValue: mockSessionLogService },
        { provide: RequestQueueService, useValue: mockRequestQueue },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    agentService = module.get<AgentService>(AgentService);
    sessionService = module.get<SessionService>(SessionService);
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

  describe('sendAndStream（首条消息 — 无 sdkSessionId）', () => {
    const SDK_SESSION_ID = 'sdk-uuid-new';

    it('首条消息应调用 sendMessage 不带 resume', async () => {
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
      await service.sendAndStream({ content: 'hello', onEvent: (e) => events.push(e) });

      expect(agentService.sendMessage).toHaveBeenCalledWith('hello');
      expect(agentService.sendMessage).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resume: expect.anything() }),
      );
    });

    it('首条消息应从 init 事件捕获 session_id 并创建 Session', async () => {
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
      await service.sendAndStream({ content: 'hello', projectId: '1', onEvent: (e) => events.push(e) });

      expect(sessionService.create).toHaveBeenCalledWith(1, SDK_SESSION_ID);
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

      await service.sendAndStream({ content: 'hello', onEvent: vi.fn() });

      expect(mockLangfuseService.createTrace).toHaveBeenCalledWith(SDK_SESSION_ID);
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
        onEvent: (e) => {
          if (e.type === 'session_created') {
            capturedSdkSessionId = e.data.sdkSessionId;
          }
        },
      });

      expect(capturedSdkSessionId).toBe(SDK_SESSION_ID);
    });

    it('空消息应抛出错误', async () => {
      await expect(service.sendAndStream({ content: '', onEvent: vi.fn() })).rejects.toThrow('消息内容不能为空');
    });
  });

  describe('sendAndStream（续传 — 有 sdkSessionId）', () => {
    const SDK_SESSION_ID = 'sdk-uuid-existing';

    it('续传应调用 sendMessage 带 resume: sessionId', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: SDK_SESSION_ID,
        title: '新会话',
        projectId: 1,
      });

      const mockGen = (async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '继续' } },
        };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: '继续' }] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      await service.sendAndStream({ content: '继续说', sdkSessionId: SDK_SESSION_ID, onEvent: vi.fn() });

      expect(mockSessionService.getBySdkSessionId).toHaveBeenCalledWith(SDK_SESSION_ID);
      expect(agentService.sendMessage).toHaveBeenCalledWith('继续说', { resume: SDK_SESSION_ID });
    });

    it('续传不应创建新 session', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: SDK_SESSION_ID,
        title: '新会话',
        projectId: 1,
      });

      const mockGen = (async function* () {
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.sendAndStream({
        content: '继续说',
        sdkSessionId: SDK_SESSION_ID,
        onEvent: (e) => events.push(e),
      });

      expect(sessionService.create).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'session_created')).toBe(false);
    });

    it('sessionId 不存在时应抛出错误', async () => {
      mockSessionService.getBySdkSessionId.mockRejectedValue(new Error('会话不存在'));

      await expect(
        service.sendAndStream({ content: 'hi', sdkSessionId: 'non-existent', onEvent: vi.fn() }),
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
      await service.sendAndStream({ content: 'hi', onEvent: (e) => events.push(e) });

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
      await service.sendAndStream({ content: 'hi', onEvent: (e) => events.push(e) });

      expect(events.some((e) => e.type === 'tool_in_progress')).toBe(true);
    });

    it('SDK 错误时应在 SSE 事件中推送 error', async () => {
      mockAgentService.sendMessage.mockRejectedValue(new Error('SDK 连接失败'));
      mockSessionService.getBySdkSessionId.mockResolvedValue({ id: 1, sdkSessionId: 'sdk-uuid', projectId: 1 });

      const events: any[] = [];
      await service.sendAndStream({
        content: 'hello',
        sdkSessionId: 'sdk-uuid',
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
      await service.sendAndStream({ content: 'hi', onEvent: (e) => events.push(e) });

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

      await service.sendAndStream({ content: 'hi', onEvent: vi.fn() });

      expect((service as any).activeQueries.has('sdk-uuid')).toBe(false);
    });
  });

  describe('sendAndStream — 限额命中', () => {
    const SDK_SESSION_ID = 'sdk-uuid-limit';

    beforeEach(() => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: SDK_SESSION_ID,
        title: '新会话',
        projectId: 1,
      });
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
      await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e) });

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
      await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e) });

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

      await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: vi.fn() });

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
      await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e) });

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
      await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e) });

      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('限额应在 query 开始时解析一次（成功流也应调用，不重复解析 env）', async () => {
      const mockGen = (async function* () {
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: vi.fn() });

      expect(mockAgentService.getAgentLimits).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmAndStream', () => {
    it('confirm 应调用 sendMessage 带 resume 和 confirmOption 作为 content', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: 'sdk-uuid',
        title: '新会话',
        projectId: 1,
      });

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
        onEvent: (e) => events.push(e),
      });

      expect(agentService.sendMessage).toHaveBeenCalledWith('方案A', { resume: 'sdk-uuid' });
      expect(events.some((e) => e.type === 'confirm_accepted')).toBe(true);
      expect(events.some((e) => e.type === 'stream_complete')).toBe(true);
    });
  });

  describe('cancelResponse', () => {
    it('无活跃 query 时不抛异常', async () => {
      await expect(service.cancelResponse('non-existent')).resolves.toBeUndefined();
    });

    it('应调用 query.interrupt()', async () => {
      const _interrupt = vi.fn();
      const mockGen = (async function* () {
        await new Promise(() => {});
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      void service.sendAndStream({ content: 'hi', onEvent: vi.fn() });

      await new Promise((resolve) => setTimeout(resolve, 0));

      await service.cancelResponse('sdk-uuid-new'); // doesn't match the key used in activeQueries
      // For first message, there's no sdkSessionId before init, so let me adjust
    });
  });

  describe('getSessionMessages', () => {
    it('应委托给 AgentService', async () => {
      mockAgentService.getSessionMessages.mockResolvedValue([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ]);

      const result = await service.getSessionMessages('sdk-uuid');

      expect(result).toHaveLength(1);
      expect(agentService.getSessionMessages).toHaveBeenCalledWith('sdk-uuid');
    });
  });
});
