import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChatService, SseEventType } from './chat.service';
import type { SseEvent } from './chat.service';

/** 创建一个 ReadableStream 模拟 SSE 响应体 */
function sseStream(body: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

describe('ChatService', () => {
  let service: ChatService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [ChatService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    service = TestBed.inject(ChatService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock?.verify();
    vi.clearAllMocks();
  });

  describe('sendMessage (fetch 流)', () => {
    it('应 POST /api/v1/chat 并回调 SSE 事件', async () => {
      const events: SseEvent[] = [];
      const completed = vi.fn();

      // 模拟 fetch 返回 SSE 流
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream(
          'event: message_start\ndata: {"type":"message_start","data":{"content":"分析中"}}\n\n' +
            'event: message_delta\ndata: {"type":"message_delta","data":{"content":"请稍候"}}\n\n' +
            'event: message_done\ndata: {"type":"message_done","data":{}}\n\n',
        ),
      });

      service.sendMessage({
        content: '你好',
        onEvent: (e) => events.push(e),
        onComplete: completed,
      });

      // 等待微任务队列完成 (fetch → ReadableStream → 解析)
      await vi.waitUntil(() => completed.mock.calls.length > 0, { timeout: 1000 });

      // 验证 fetch 调用
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'message', content: '你好' }),
        }),
      );

      // 验证事件回调
      expect(events.length).toBe(3);
      expect(events[0].type).toBe(SseEventType.MessageStart);
      expect(events[0].data).toEqual({ content: '分析中' });
      expect(events[1].type).toBe(SseEventType.MessageDelta);
      expect(events[1].data).toEqual({ content: '请稍候' });
      expect(events[2].type).toBe(SseEventType.MessageDone);
      expect(completed).toHaveBeenCalledOnce();
    });

    it('sessionId 存在时应传入 body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('event: message_done\ndata: {"type":"message_done","data":{}}\n\n'),
      });

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: '继续',
          sessionId: 'sdk-abc',
          onEvent: () => {},
          onComplete: () => resolve(),
        });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({ action: 'message', content: '继续', sessionId: 'sdk-abc' }),
        }),
      );
    });

    it('projectId 存在时应传入 body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('event: message_done\ndata: {"type":"message_done","data":{}}\n\n'),
      });

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: '你好',
          projectId: 1,
          onEvent: () => {},
          onComplete: () => resolve(),
        });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({ action: 'message', content: '你好', projectId: 1 }),
        }),
      );
    });

    it('HTTP 错误应触发 onError 回调', async () => {
      const onError = vi.fn();

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: '你好',
          onEvent: () => {},
          onError: (msg) => {
            onError(msg);
            resolve();
          },
        });
      });

      expect(onError).toHaveBeenCalledWith('Bad Request');
    });

    it('Fetch 抛异常应触发 onError 回调', async () => {
      const onError = vi.fn();

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: '你好',
          onEvent: () => {},
          onError: (msg) => {
            onError(msg);
            resolve();
          },
        });
      });

      expect(onError).toHaveBeenCalledWith('Network failure');
    });

    it('应返回 AbortController 用于中断', () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('data: {"type":"message_done","data":{}}\n\n'),
      });

      const controller = service.sendMessage({
        content: '你好',
        onEvent: () => {},
      });

      expect(controller).toBeInstanceOf(AbortController);
      controller.abort();
    });

    it('所有 SSE data 行应解析为 events（不含 event: 前缀时用空字符串）', async () => {
      const events: SseEvent[] = [];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream(
          'data: {"type":"text_chunk","data":{"text":"hello"}}\n\n' +
            'event: done\ndata: {"type":"done","data":{}}\n\n',
        ),
      });

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: '测试',
          onEvent: (e) => events.push(e),
          onComplete: () => resolve(),
        });
      });

      expect(events.length).toBe(2);
      expect(events[0].type).toBe('');
      expect(events[0].data).toEqual({ text: 'hello' });
      expect(events[1].type).toBe('done');
    });
  });

  describe('confirmChoice (fetch 流)', () => {
    it('应 POST /api/v1/chat 含 confirm action', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('event: confirm_accepted\ndata: {"type":"confirm_accepted","data":{}}\n\n'),
      });

      const events: SseEvent[] = [];

      await new Promise<void>((resolve) => {
        service.confirmChoice({
          sessionId: 'sdk-abc',
          confirmOption: 'A方案',
          onEvent: (e) => events.push(e),
          onComplete: () => resolve(),
        });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'confirm', sessionId: 'sdk-abc', confirmOption: 'A方案' }),
        }),
      );
      expect(events[0].type).toBe(SseEventType.ConfirmAccepted);
    });
  });

  describe('cancelResponse (HttpClient)', () => {
    it('应 POST /api/v1/chat 含 cancel action', () => {
      service.cancelResponse('sdk-abc').subscribe();

      const req = httpMock.expectOne('/api/v1/chat');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ action: 'cancel', sessionId: 'sdk-abc' });
      req.flush({ success: true });
    });
  });

  describe('loadHistory (HttpClient)', () => {
    it('应 GET /api/v1/sessions/:sdkSessionId/messages', () => {
      const mockMessages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];

      service.loadHistory('sdk-abc').subscribe((data) => {
        expect(data).toEqual(mockMessages);
      });

      const req = httpMock.expectOne('/api/v1/sessions/sdk-abc/messages');
      expect(req.request.method).toBe('GET');
      req.flush(mockMessages);
    });
  });

  describe('getModels (HttpClient)', () => {
    it('应 GET /api/v1/models 并返回模型列表', () => {
      const mockModels = [
        { name: 'deepseek', displayName: 'DeepSeek', default: true },
        { name: 'kimi', displayName: 'Kimi K2', default: false },
      ];

      service.getModels().subscribe((models) => {
        expect(models).toEqual(mockModels);
      });

      const req = httpMock.expectOne('/api/v1/models');
      expect(req.request.method).toBe('GET');
      req.flush(mockModels);
    });
  });

  describe('model 透传', () => {
    it('sendMessage 传 model 时 body 应含 model', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('data: {"type":"done","data":{}}\n\n'),
      });

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: '你好',
          model: 'kimi',
          onEvent: () => {},
          onComplete: () => resolve(),
        });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({ action: 'message', content: '你好', model: 'kimi' }),
        }),
      );
    });

    it('confirmChoice 传 model 时 body 应含 model', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('data: {"type":"done","data":{}}\n\n'),
      });

      await new Promise<void>((resolve) => {
        service.confirmChoice({
          sessionId: 'sdk-abc',
          confirmOption: 'A方案',
          model: 'kimi',
          onEvent: () => {},
          onComplete: () => resolve(),
        });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({ action: 'confirm', sessionId: 'sdk-abc', confirmOption: 'A方案', model: 'kimi' }),
        }),
      );
    });
  });

  describe('Authorization header', () => {
    beforeEach(() => {
      localStorage.setItem('oceanus_token', 'test-token');
    });

    it('sendMessage 应携带 Bearer token', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream('data: {"type":"done","data":{}}\n\n'),
      });

      await new Promise<void>((resolve) => {
        service.sendMessage({
          content: 'hi',
          onEvent: () => {},
          onComplete: () => resolve(),
        });
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('cancelResponse 应携带 Bearer token', () => {
      service.cancelResponse('sdk-abc').subscribe();
      const req = httpMock.expectOne('/api/v1/chat');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush({});
    });
  });
});
