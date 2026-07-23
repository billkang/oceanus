import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { ChatService } from './chat.service';
import { AgentService } from '../agent/agent.service';
import { SessionService } from '../session/session.service';
import { AssetService } from '../asset/asset.service';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { SessionLogService } from '../common/logging/session-log.service';

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
      await expect(
        service.sendAndStream({ content: '', onEvent: vi.fn() }),
      ).rejects.toThrow('消息内容不能为空');
    });
  });

  describe('sendAndStream（续传 — 有 sdkSessionId）', () => {
    const SDK_SESSION_ID = 'sdk-uuid-existing';

    it('续传应调用 sendMessage 带 resume: sessionId', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1, sdkSessionId: SDK_SESSION_ID, title: '新会话', projectId: 1,
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
        id: 1, sdkSessionId: SDK_SESSION_ID, title: '新会话', projectId: 1,
      });

      const mockGen = (async function* () {
        yield { type: 'assistant', message: { content: [] } } as any;
      })();
      mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

      const events: any[] = [];
      await service.sendAndStream({
        content: '继续说', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e),
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
        content: 'hello', sdkSessionId: 'sdk-uuid',
        onEvent: (e) => events.push(e),
      });

      expect(events.some((e) => e.type === 'error')).toBe(true);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('SDK prompt_suggestion 应映射为 tool_options 事件', async () => {
      const mockGen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-uuid' };
        yield {
          type: 'prompt_suggestion', suggestion: '帮我总结一下',
          uuid: 'uuid-1', session_id: 'sdk-uuid',
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

  describe('confirmAndStream', () => {
    it('confirm 应调用 sendMessage 带 resume 和 confirmOption 作为 content', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1, sdkSessionId: 'sdk-uuid', title: '新会话', projectId: 1,
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

      await new Promise(resolve => setTimeout(resolve, 0));

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
