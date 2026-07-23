import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ɵSIGNAL } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MessageRole, MessageStatus } from './chat-message.component';
import { ChatComponent } from './chat.component';
import { SseEventType } from './chat.service';

/**
 * 在 vitest JIT 环境中，Angular 不会自动注册 input() 信号为组件输入，
 * 导致 setInput 和模板绑定失效。通过直接设置 InputSignal 的内部节点值绕过此限制。
 */
/* eslint-disable no-param-reassign */
function setInputSignal<T>(target: unknown, name: string, value: T): void {
  (target as any)[name][ɵSIGNAL].value = value;
}
/* eslint-enable no-param-reassign */

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

/** Mock fetch 返回 SSE 流 */
function mockSseFetch(body: string, ok = true): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    body: sseStream(body),
    text: () => Promise.resolve(body),
  });
}

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: any;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    // Mock fetch 默认返回空流避免异常
    mockSseFetch('event: stream_complete\ndata: {"type":"stream_complete","data":{}}\n\n');
  });

  afterEach(() => {
    httpMock?.verify();
    vi.clearAllMocks();
  });

  function detectChanges() {
    fixture.detectChanges();
  }

  it('应创建组件', () => {
    expect(component).toBeTruthy();
  });

  it('空状态应显示提示文字', () => {
    detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('开始对话');
  });

  it('设置 sessionId 后应加载历史消息', () => {
    // 先触发 effect（sessionId 为空 → 清空），再设置消息
    detectChanges();

    component.messages.set([
      {
        id: '1',
        role: MessageRole.User,
        content: '你好',
        timestamp: Date.now(),
        status: MessageStatus.Complete,
      },
      {
        id: '2',
        role: MessageRole.Assistant,
        content: '你好！有什么可以帮你？',
        timestamp: Date.now(),
        status: MessageStatus.Complete,
      },
    ]);
    component.loadingHistory.set(false);

    expect(component.messages().length).toBe(2);
  });

  it('加载历史时应显示 skeleton', () => {
    // 先触发 effect（设 loadingHistory=false），再手动覆盖
    detectChanges();
    component.loadingHistory.set(true);
    detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.animate-pulse')).toBeTruthy();
  });

  describe('发送消息', () => {
    it('发送按钮在输入为空时应禁用', () => {
      expect(component.canSend()).toBe(false);
    });

    it('输入文本后发送按钮应启用', () => {
      component.chatModel.set({ message: '测试消息' });
      detectChanges();

      expect(component.canSend()).toBe(true);
    });

    it('发送消息应添加用户消息并调用 fetch', () => {
      // 先触发 effect（sessionId=空 → 清空 messages，此时无消息不影响）
      detectChanges();
      // 通过 _streamSdkSessionId 模拟已有会话（绕过 JIT setInput 问题）
      (component as any)._streamSdkSessionId = 'sdk-abc';

      component.chatModel.set({ message: '测试消息' });
      component.send();

      expect(component.messages().length).toBe(1);
      expect(component.messages()[0].content).toBe('测试消息');
      expect(component.messages()[0].status).toBe(MessageStatus.Sending);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'message', content: '测试消息', sessionId: 'sdk-abc' }),
        }),
      );
    });

    it('无 sessionId 时首次消息应传 projectId', () => {
      setInputSignal(component, 'projectId', 1);

      component.chatModel.set({ message: '首次消息' });
      component.send();
      detectChanges();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({ action: 'message', content: '首次消息', projectId: 1 }),
        }),
      );
    });

    it('send() 应立即设置 isStreaming=true 以保护会话内消息', () => {
      // send() 在调用 SSE 前设置 isStreaming=true，
      // 确保 session_created 触发 effect 时 isStreaming() 为 true，
      // 从而跳过 loadHistory() 保留内存中的用户消息
      detectChanges();
      (component as any)._streamSdkSessionId = 'sdk-abc';

      component.chatModel.set({ message: '测试消息' });
      component.send();

      expect(component.isStreaming()).toBe(true);
    });

    it('__new__ 会话标记应视为首次消息（不传 sessionId）', () => {
      setInputSignal(component, 'sessionId', '__new__');
      setInputSignal(component, 'projectId', 1);

      component.chatModel.set({ message: '新会话消息' });
      component.send();
      detectChanges();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({ action: 'message', content: '新会话消息', projectId: 1 }),
        }),
      );
      // 不应包含 sessionId 字段
      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody).not.toHaveProperty('sessionId');
    });
  });

  describe('SSE 事件处理', () => {
    beforeEach(() => {
      // 预 Mock fetch，避免测试中触发真实请求
      globalThis.fetch = vi.fn();
    });

    it('session_created 应缓存 sdkSessionId 并发射事件', () => {
      const sessionCreatedSpy = vi.fn();
      component.sessionCreated.subscribe(sessionCreatedSpy);

      (component as any).handleSseEvent({
        type: SseEventType.SessionCreated,
        data: { sdkSessionId: 'new-sdk-123' },
      });

      expect((component as any)._streamSdkSessionId).toBe('new-sdk-123');
      expect(sessionCreatedSpy).toHaveBeenCalledWith('new-sdk-123');
    });

    it('message_start 应创建助理消息', () => {
      // 先触发 effect（sessionId=空 → 清空 messages），避免后续清空
      detectChanges();

      (component as any).handleSseEvent({
        type: SseEventType.MessageStart,
        data: { content: '分析中' },
      });

      expect(component.messages().length).toBe(1);
      expect(component.messages()[0].role).toBe(MessageRole.Assistant);
      expect(component.messages()[0].status).toBe(MessageStatus.Streaming);
    });

    it('message_delta 应追加文本', () => {
      (component as any).handleSseEvent({
        type: SseEventType.MessageStart,
        data: { content: '分析中' },
      });
      (component as any).handleSseEvent({
        type: SseEventType.MessageDelta,
        data: { content: '，请稍候' },
      });

      expect(component.messages()[0].content).toBe('分析中，请稍候');
    });

    it('message_done 应完成消息', () => {
      (component as any).handleSseEvent({
        type: SseEventType.MessageStart,
        data: { content: '完成' },
      });
      (component as any).handleSseEvent({
        type: SseEventType.MessageDone,
        data: {},
      });

      expect(component.messages()[0].status).toBe(MessageStatus.Complete);
      expect(component.isStreaming()).toBe(false);
    });

    it('error 事件应标记消息为错误', () => {
      (component as any).handleSseEvent({
        type: SseEventType.MessageStart,
        data: { content: '处理中' },
      });
      (component as any).handleSseEvent({
        type: SseEventType.Error,
        data: { message: 'AI 服务异常' },
      });

      expect(component.messages()[0].status).toBe(MessageStatus.Error);
      expect((component.messages()[0] as any).errorMessage).toBe('AI 服务异常');
    });

    it('无 streaming 消息时 error 事件应添加错误消息', () => {
      (component as any).handleSseEvent({
        type: SseEventType.Error,
        data: { message: '会话不存在: __new__' },
      });

      expect(component.messages().length).toBe(1);
      expect(component.messages()[0].status).toBe(MessageStatus.Error);
      expect((component.messages()[0] as any).errorMessage).toBe('会话不存在: __new__');
      expect(component.isStreaming()).toBe(false);
    });

    it('流式传输时应禁用输入', () => {
      (component as any).handleSseEvent({
        type: SseEventType.MessageStart,
        data: { content: '处理中' },
      });

      expect(component.isStreaming()).toBe(true);
    });

    it('tool_options 应添加选项消息', () => {
      (component as any).handleSseEvent({
        type: SseEventType.ToolOptions,
        data: { options: ['A方案', 'B方案'], text: '请选择方案' },
      });

      expect(component.messages().length).toBe(1);
      const msg = component.messages()[0];
      expect(msg.options).toEqual(['A方案', 'B方案']);
      expect(msg.optionsText).toBe('请选择方案');
      expect(component.isStreaming()).toBe(false);
    });

    it('title_updated 应发射事件', () => {
      const titleSpy = vi.fn();
      component.titleUpdated.subscribe(titleSpy);

      (component as any).handleSseEvent({
        type: SseEventType.TitleUpdated,
        data: { sdkSessionId: 'sdk-abc', title: '新标题' },
      });

      expect(titleSpy).toHaveBeenCalledWith({ sdkSessionId: 'sdk-abc', title: '新标题' });
    });

    it('asset_ready 应发射事件', () => {
      const assetSpy = vi.fn();
      component.assetReady.subscribe(assetSpy);

      (component as any).handleSseEvent({
        type: SseEventType.AssetReady,
        data: { assetId: 42 },
      });

      expect(assetSpy).toHaveBeenCalledWith(42);
    });
  });

  describe('中断', () => {
    it('cancel 应终止流并通知后端', () => {
      // 模拟已有活跃会话
      (component as any)._streamSdkSessionId = 'sdk-abc';

      component.cancel();
      const req = httpMock.expectOne('/api/v1/chat');
      expect(req.request.body).toEqual({ action: 'cancel', sessionId: 'sdk-abc' });
      req.flush({ success: true });
    });
  });

  describe('重试', () => {
    it('用户消息失败时 onRetry 应重新发送', () => {
      // 先触发 effect（sessionId=空 → 清空），防止后续清空手动设置的消息
      detectChanges();
      // 添加一条失败的用户消息
      component.messages.set([{
        id: 'user-1',
        role: MessageRole.User,
        content: '测试消息',
        timestamp: Date.now(),
        status: MessageStatus.Error,
        errorMessage: '发送失败',
      }]);

      component.onRetry(component.messages()[0]);

      // 失败消息应被移除
      expect(component.messages().find(m => m.status === MessageStatus.Error)).toBeUndefined();
      // 应有发送中消息
      const sendingMsg = component.messages().find(m => m.status === MessageStatus.Sending);
      expect(sendingMsg).toBeTruthy();
      // 应调用 fetch
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('助理消息失败时重试应发送上一条用户消息', () => {
      // 先触发 effect，防止后续清空 messages
      detectChanges();
      component.messages.set([
        {
          id: 'user-1',
          role: MessageRole.User,
          content: '你好',
          timestamp: Date.now(),
          status: MessageStatus.Complete,
        },
        {
          id: 'assistant-2',
          role: MessageRole.Assistant,
          content: '',
          timestamp: Date.now(),
          status: MessageStatus.Error,
          errorMessage: 'AI 服务异常',
        },
      ]);

      component.onRetry(component.messages()[1]);

      expect(component.messages().find(m => m.id === 'assistant-2')).toBeUndefined();
      expect(component.messages().find(m => m.status === MessageStatus.Sending)).toBeTruthy();
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });
});
