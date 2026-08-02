import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  input,
  type OnDestroy,
  type OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { form, FormField } from '@angular/forms/signals';
import { Button } from 'primeng/button';
import { Popover } from 'primeng/popover';
import { Select } from 'primeng/select';
import type { DisplayMessage } from './chat-message.component';
import { ChatMessageComponent, MessageRole, MessageStatus } from './chat-message.component';
import type { SseEvent } from './chat.service';
import { ChatService, SseEventType, type ModelInfo } from './chat.service';

/* ── SSE 事件数据类型 ── */
interface MessageStartData {
  content: string;
}
interface MessageDeltaData {
  content: string;
}
interface ToolInProgressData {
  status: string;
}
interface ToolOptionsData {
  options: string[];
  text: string;
}
interface AssetReadyData {
  assetId: number;
}
interface SessionCreatedData {
  sdkSessionId: string;
}
interface TitleUpdatedData {
  sdkSessionId: string;
  title: string;
}
interface ErrorEventData {
  message: string;
}
interface QueuedData {
  position: number;
  estimatedWait: string;
}
interface QueuePositionData {
  position: number;
  totalBefore: number;
}
/** 限额命中事件数据（轮次 / 预算共用，结构相同） */
interface LimitReachedData {
  limit: number;
}

/* ── 历史消息数据类型 ── */
interface ContentBlock {
  type: string;
  text: string;
}

/** SDK getSessionMessages 实际返回的 SessionMessage 结构 */
interface SdkMessage {
  type: 'user' | 'assistant' | 'system';
  message: {
    role?: string;
    content?: string | ContentBlock[];
    [key: string]: unknown;
  };
  timestamp?: string;
  created_at?: string;
}

@Component({
  selector: 'app-chat',
  imports: [ChatMessageComponent, Button, FormField, FormsModule, Popover, Select],
  standalone: true,
  templateUrl: './chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements OnInit, OnDestroy {
  private readonly chatService = inject(ChatService);

  readonly sessionId = input<string>('');
  /** 项目 projectName，新会话首条消息作为 projectName 传给后端（成员校验 + 分区） */
  readonly projectName = input('');
  readonly assetReady = output<number>();
  readonly titleUpdated = output<{ sdkSessionId: string; title: string }>();
  readonly sessionCreated = output<string>();

  readonly messages = signal<DisplayMessage[]>([]);
  readonly chatModel = signal({ message: '' });
  readonly chatForm = form(this.chatModel);
  readonly aiStatus = signal('');
  readonly loadingHistory = signal(false);
  readonly isStreaming = signal(false);
  readonly showScrollButton = signal(false);
  readonly canSend = computed(() => this.chatModel().message.trim().length > 0 && !this.isStreaming());
  readonly queuePosition = signal<number | null>(null);
  readonly estimatedWait = signal('');
  /** 限额命中提示（内联横幅文案，下次发送清空） */
  readonly limitNotice = signal('');
  /** 可用模型列表（来自 GET /models；多模型时渲染选择器） */
  readonly models = signal<ModelInfo[]>([]);
  /** 当前选中的模型名（空串 = 未选择，发送走默认 provider） */
  readonly selectedModel = signal('');

  private messageIdCounter = 0;
  /** 用户是否主动滚到了历史区域（不在底部） */
  private userScrolledUp = false;
  /** 当前 SSE 流的 AbortController */
  private abortController: AbortController | null = null;
  /** 状态栏清除定时器（用于延迟消失） */
  private statusClearTimer: ReturnType<typeof setTimeout> | null = null;
  /** 首次消息时由 session_created 事件缓存的 sdkSessionId */
  private _streamSdkSessionId: string | null = null;
  /** 上一次加载历史的 sessionId，用于区分是否为切换会话 */
  private _previousSessionId = '';

  readonly messageContainer = viewChild<ElementRef<HTMLElement>>('messageContainer');
  readonly inputField = viewChild<ElementRef<HTMLTextAreaElement>>('inputField');

  constructor() {
    // 监听 sessionId 信号变化（仅在 sessionId 真正改变时加载历史，
    // 避免 isStreaming 变化时误触发 loadHistory 清空消息列表）
    effect(() => {
      const sid = this.sessionId();
      if (sid === this._previousSessionId) return;
      this._previousSessionId = sid;

      // 切换会话时清空上一会话的限额提示横幅
      this.limitNotice.set('');

      if (!sid || sid === '__new__') {
        this._streamSdkSessionId = null;
        this.messages.set([]);
        this.loadingHistory.set(false);
        return;
      }
      if (this.isStreaming()) {
        // 流式传输中不重载历史（首次消息时 sessionId 从 '' → sdkSessionId）
        return;
      }
      this._streamSdkSessionId = null;
      this.showScrollButton.set(false);
      this.loadHistory();
    });
  }

  ngOnInit(): void {
    this.chatService.getModels().subscribe({
      next: (models) => {
        this.models.set(models);
        const def = models.find((m) => m.default);
        this.selectedModel.set(def?.name ?? models[0]?.name ?? '');
      },
      error: () => {
        // 模型列表获取失败：不渲染选择器，发送走默认 provider
      },
    });
  }

  /** 用户切换模型（p-select onChange） */
  onModelChange(model: string): void {
    this.selectedModel.set(model);
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
  }

  /** 获取当前活跃的 sdkSessionId（流缓存优先，__new__ 为无效占位符） */
  private get activeSdkSessionId(): string | undefined {
    const sid = this.sessionId();
    return this._streamSdkSessionId || (sid && sid !== '__new__' ? sid : undefined);
  }

  /** 设置 AI 状态，自动取消之前的清除定时器 */
  private setAiStatus(status: string): void {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
    this.aiStatus.set(status);
  }

  /** 延迟清除 AI 状态（默认 500 毫秒后消失） */
  private clearAiStatus(delayMs = 500): void {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
    }
    this.statusClearTimer = setTimeout(() => {
      this.aiStatus.set('');
      this.statusClearTimer = null;
    }, delayMs);
  }

  /** 加载历史消息 */
  private loadHistory(): void {
    const sid = this.sessionId();
    if (!sid) return;

    this.loadingHistory.set(true);
    this.messages.set([]);

    this.chatService.loadHistory(sid).subscribe({
      next: (data: unknown) => {
        if (Array.isArray(data)) {
          const converted = this.convertHistoryToMessages(data as SdkMessage[]);
          this.messages.set(converted);
        }
        this.loadingHistory.set(false);
        this.scrollToBottom();
      },
      error: () => {
        this.loadingHistory.set(false);
      },
    });
  }

  /** 处理滚动事件 */
  onScroll(): void {
    const container = this.messageContainer()?.nativeElement;
    if (!container) return;

    const threshold = 80; // px from bottom
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    this.userScrolledUp = !atBottom;
    this.showScrollButton.set(this.userScrolledUp);
  }

  /** 处理 SSE 事件 */
  private handleSseEvent(event: SseEvent): void {
    switch (event.type) {
      case SseEventType.SessionCreated: {
        const data = event.data as unknown as SessionCreatedData;
        if (data?.sdkSessionId) {
          this._streamSdkSessionId = data.sdkSessionId;
          this.sessionCreated.emit(data.sdkSessionId);
        }
        break;
      }

      case SseEventType.MessageStart:
        this.messages.update((list) => [
          ...list,
          {
            id: `assistant-${++this.messageIdCounter}`,
            role: MessageRole.Assistant,
            content: (event.data as unknown as MessageStartData).content || '',
            timestamp: Date.now(),
            status: MessageStatus.Streaming,
          },
        ]);
        this.isStreaming.set(true);
        this.scrollToBottomIfNear();
        break;

      case SseEventType.MessageDelta:
        this.messages.update((list) => {
          const last = list[list.length - 1];
          if (last && last.status === MessageStatus.Streaming) {
            return list.map((m, i) =>
              i === list.length - 1
                ? { ...m, content: m.content + ((event.data as unknown as MessageDeltaData).content || '') }
                : m,
            );
          }
          return list;
        });
        this.scrollToBottomIfNear();
        break;

      case SseEventType.MessageDone:
      case SseEventType.StreamComplete:
        this.messages.update((list) => {
          const last = list[list.length - 1];
          if (last && last.status === MessageStatus.Streaming) {
            return list.map((m, i) => (i === list.length - 1 ? { ...m, status: MessageStatus.Complete } : m));
          }
          return list;
        });
        this.isStreaming.set(false);
        this.clearAiStatus();
        this.scrollToBottomIfNear();
        break;

      case SseEventType.MessageComplete:
        this.isStreaming.set(false);
        this.clearAiStatus();
        break;

      case SseEventType.ToolInProgress:
        this.setAiStatus((event.data as unknown as ToolInProgressData).status || '处理中...');
        break;

      case SseEventType.ToolComplete:
        this.clearAiStatus();
        break;

      case SseEventType.ToolOptions: {
        const options: string[] = (event.data as unknown as ToolOptionsData).options || [];
        const optionsText: string = (event.data as unknown as ToolOptionsData).text || '';
        this.messages.update((list) => [
          ...list,
          {
            id: `options-${++this.messageIdCounter}`,
            role: MessageRole.Assistant,
            content: optionsText,
            timestamp: Date.now(),
            status: MessageStatus.Complete,
            options,
            optionsText,
          },
        ]);
        this.isStreaming.set(false);
        this.scrollToBottomIfNear();
        break;
      }

      case SseEventType.AssetReady: {
        const assetId: number = (event.data as unknown as AssetReadyData).assetId || 0;
        if (assetId) {
          this.assetReady.emit(assetId);
        }
        break;
      }

      case SseEventType.TitleUpdated: {
        const data = event.data as unknown as TitleUpdatedData;
        if (data?.title) {
          this.titleUpdated.emit(data);
        }
        break;
      }

      case SseEventType.Error:
        this.messages.update((list) => {
          const last = list[list.length - 1];
          if (last && last.status === MessageStatus.Streaming) {
            return list.map((m, i) =>
              i === list.length - 1
                ? {
                    ...m,
                    status: MessageStatus.Error,
                    errorMessage: (event.data as unknown as ErrorEventData).message,
                  }
                : m,
            );
          }
          return [
            ...list,
            {
              id: `error-${++this.messageIdCounter}`,
              role: MessageRole.Assistant,
              content: '',
              timestamp: Date.now(),
              status: MessageStatus.Error,
              errorMessage: (event.data as unknown as ErrorEventData).message,
            },
          ];
        });
        this.isStreaming.set(false);
        break;

      case SseEventType.SseError:
        break;

      case SseEventType.Queued: {
        const qd = event.data as unknown as QueuedData;
        this.queuePosition.set(qd.position);
        this.estimatedWait.set(qd.estimatedWait || '');
        this.isStreaming.set(true); // Keep input disabled while queued
        break;
      }

      case SseEventType.QueuePosition: {
        const qpd = event.data as unknown as QueuePositionData;
        this.queuePosition.set(qpd.position);
        break;
      }

      case SseEventType.Dequeued:
        this.queuePosition.set(null);
        this.estimatedWait.set('');
        break;

      case SseEventType.TurnLimitReached:
        this.limitNotice.set(
          `已达到本次轮次上限（${(event.data as unknown as LimitReachedData).limit} 轮），你可以继续发送消息`,
        );
        break;

      case SseEventType.BudgetLimitReached:
        // Number() 防御：limit 缺失 / 非数字时降级为 "NaN" 而不抛错
        this.limitNotice.set(
          `已达到本次预算上限（$${Number((event.data as unknown as LimitReachedData).limit).toFixed(2)}），你可以继续发送消息`,
        );
        break;

      default:
        break;
    }
  }

  /** 发送消息 */
  send(): void {
    const text = this.chatModel().message.trim();
    if (!text) return;

    // 新发送时清空限额提示横幅
    this.limitNotice.set('');

    // 立即标记为流式中，确保 session_created 触发 effect 时
    // isStreaming() === true，保护内存中的消息不被 loadHistory 清空
    this.isStreaming.set(true);

    const msgId = `user-${++this.messageIdCounter}`;

    this.messages.update((list) => [
      ...list,
      {
        id: msgId,
        role: MessageRole.User,
        content: text,
        timestamp: Date.now(),
        status: MessageStatus.Sending,
      },
    ]);

    this.chatModel.set({ message: '' });
    this.userScrolledUp = false;
    this.scrollToBottom();
    this.autoResizeTextarea();

    let userMsgCompleted = false;

    this.abortController = this.chatService.sendMessage({
      content: text,
      sessionId: this.activeSdkSessionId,
      projectName: this.activeSdkSessionId ? undefined : this.projectName(),
      model: this.selectedModel() || undefined,
      onEvent: (event) => {
        if (!userMsgCompleted) {
          this.messages.update((list) =>
            list.map((m) => (m.id === msgId ? { ...m, status: MessageStatus.Complete } : m)),
          );
          userMsgCompleted = true;
        }
        this.handleSseEvent(event);
      },
      onComplete: () => {
        this.isStreaming.set(false);
        this.abortController = null;
        if (!userMsgCompleted) {
          this.messages.update((list) =>
            list.map((m) => (m.id === msgId ? { ...m, status: MessageStatus.Complete } : m)),
          );
        }
      },
      onError: (errMsg) => {
        this.messages.update((list) =>
          list.map((m) => (m.id === msgId ? { ...m, status: MessageStatus.Error, errorMessage: errMsg } : m)),
        );
        this.isStreaming.set(false);
        this.abortController = null;
      },
    });
  }

  /** 中断 AI 响应 */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;

    const sid = this.activeSdkSessionId;
    if (sid) {
      this.chatService.cancelResponse(sid).subscribe({
        error: () => console.warn('Cancel request failed'),
      });
    }

    this.isStreaming.set(false);
  }

  /** 重试发送失败的消息 */
  onRetry(msg: DisplayMessage): void {
    const list = this.messages();
    const idx = list.findIndex((m) => m.id === msg.id);
    let text = '';
    if (msg.role === MessageRole.User && msg.content) {
      text = msg.content;
    } else if (msg.role === MessageRole.Assistant) {
      for (let i = idx - 1; i >= 0; i--) {
        if (list[i].role === MessageRole.User && list[i].content) {
          text = list[i].content;
          break;
        }
      }
    }
    if (!text) return;

    // 重试即新 query，清空限额提示横幅
    this.limitNotice.set('');

    // 立即标记为流式中，与 send() 保持一致
    this.isStreaming.set(true);

    this.messages.update((list) => list.filter((m) => m.id !== msg.id));

    const newMsgId = `user-${++this.messageIdCounter}`;
    this.messages.update((list) => [
      ...list,
      {
        id: newMsgId,
        role: MessageRole.User,
        content: text,
        timestamp: Date.now(),
        status: MessageStatus.Sending,
      },
    ]);

    let retryMsgCompleted = false;

    this.abortController = this.chatService.sendMessage({
      content: text,
      sessionId: this.activeSdkSessionId,
      projectName: this.activeSdkSessionId ? undefined : this.projectName(),
      model: this.selectedModel() || undefined,
      onEvent: (event) => {
        if (!retryMsgCompleted) {
          this.messages.update((list) =>
            list.map((m) => (m.id === newMsgId ? { ...m, status: MessageStatus.Complete } : m)),
          );
          retryMsgCompleted = true;
        }
        this.handleSseEvent(event);
      },
      onComplete: () => {
        this.isStreaming.set(false);
        this.abortController = null;
        if (!retryMsgCompleted) {
          this.messages.update((list) =>
            list.map((m) => (m.id === newMsgId ? { ...m, status: MessageStatus.Complete } : m)),
          );
        }
      },
      onError: (errMsg) => {
        this.messages.update((list) =>
          list.map((m) => (m.id === newMsgId ? { ...m, status: MessageStatus.Error, errorMessage: errMsg } : m)),
        );
        this.isStreaming.set(false);
        this.abortController = null;
      },
    });
  }

  /** 用户选择选项（确认交互） */
  onOptionSelect(option: string): void {
    this.messages.update((list) =>
      list.map((m) => (m.options && !m.selectedOption ? { ...m, selectedOption: option } : m)),
    );

    const sid = this.activeSdkSessionId;
    if (!sid) return;

    this.abortController = this.chatService.confirmChoice({
      sessionId: sid,
      confirmOption: option,
      model: this.selectedModel() || undefined,
      onEvent: (event) => {
        this.handleSseEvent(event);
      },
      onComplete: () => {
        this.isStreaming.set(false);
        this.abortController = null;
      },
      onError: () => {
        this.messages.update((list) =>
          list.map((m) => (m.selectedOption === option ? { ...m, selectedOption: undefined } : m)),
        );
        this.isStreaming.set(false);
        this.abortController = null;
      },
    });
  }

  /** 键盘事件处理：Enter 发送，Shift+Enter / Alt(Option)+Enter 换行 */
  onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) {
      return;
    }

    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      if (event.shiftKey || event.altKey) {
        // Shift+Enter / Alt(Option)+Enter → 换行，由 textarea 默认行为处理
        return;
      }
      // 普通 Enter → 发送
      event.preventDefault();
      this.send();
    }
  }

  /** 输入框内容变化时自动调整高度 */
  onInput(): void {
    this.autoResizeTextarea();
  }

  /** 自动调整 textarea 高度（最大 150px） */
  private autoResizeTextarea(): void {
    const el = this.inputField()?.nativeElement as HTMLTextAreaElement | undefined;
    if (!el) return;
    // 重置高度以获取正确的 scrollHeight
    el.style.height = 'auto';
    const maxHeight = 150;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  /** Skills popup 按钮高亮 */
  readonly skillsBtnActive = signal(false);

  /** Skills popup 中的技能列表 */
  readonly skills = [
    { name: '需求澄清', desc: '梳理用户、场景、痛点等，帮助识别伪需求' },
    { name: '方案对比', desc: '生成多方案对比表，推荐最优方案' },
    { name: 'Demo 生成', desc: '根据方案描述生成符合 UED 规范的可交互 HTML 原型' },
    { name: 'PRD 生成', desc: '收集产品信息生成结构化 PRD' },
    { name: 'Jira 任务同步', desc: '将 PRD 拆分为用户故事，并自动插入 Jira' },
    { name: '测试用例生成', desc: '根据 PRD 生成测试用例' },
  ];

  onSkillsShow(): void {
    this.skillsBtnActive.set(true);
  }

  onSkillsHide(): void {
    this.skillsBtnActive.set(false);
  }

  onSkillSelect(name: string): void {
    this.chatModel.set({ message: name });
    this.inputField()?.nativeElement.focus();
  }

  readonly dragOver = signal(false);

  /** 处理拖拽悬停 */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isStreaming() && event.dataTransfer) {
      const dt = event.dataTransfer;
      dt.dropEffect = 'copy';
      this.dragOver.set(true);
    }
  }

  /** 处理拖拽离开 */
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
  }

  /** 处理文件拖放 */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
    if (this.isStreaming()) return;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFiles(files);
    }
  }

  /** 处理文件选择（点击上传按钮） */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      this.processFiles(files);
      input.value = ''; // 重置以允许重复选择同一文件
    }
  }

  /** 处理上传的文件（当前仅支持单文件，可扩展为多文件） */
  private processFiles(files: FileList): void {
    // TODO: 实现文件上传到服务器的逻辑
    // 当前占位：打印文件信息
    const file = files[0];
    if (file) {
      console.log('File selected:', file.name, file.size);
      // 后续可在此处添加实际的上传逻辑
    }
  }

  /** 自动滚动到底部（无条件）
   * 使用双层 rAF 确保 Angular 完成 DOM 渲染后再滚动 */
  protected scrollToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = this.messageContainer()?.nativeElement;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });
  }

  /** 如果用户在底部附近则自动滚动 */
  private scrollToBottomIfNear(): void {
    if (!this.userScrolledUp) {
      this.scrollToBottom();
    }
  }

  /** 转换 SDK SessionMessage 为 DisplayMessage 格式 */
  private convertHistoryToMessages(data: SdkMessage[]): DisplayMessage[] {
    return (
      data
        .filter((msg) => msg.type === 'user' || msg.type === 'assistant')
        .map((msg: SdkMessage, index: number) => ({
          id: `history-${index}`,
          role: msg.type === 'user' ? MessageRole.User : MessageRole.Assistant,
          content: this.extractTextContent(msg.message?.content ?? ''),
          timestamp: Date.parse(msg.timestamp ?? msg.created_at ?? '') || Date.now(),
          status: MessageStatus.Complete,
        }))
        // 过滤掉空白/零长度的消息（避免 SDK 空白 text block 产生的幽灵气泡）
        .filter((m) => m.content && m.content.trim().length > 0)
    );
  }

  /** 从 SDK 消息格式提取文本 */
  private extractTextContent(content: string | ContentBlock[]): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((block: ContentBlock) => block.type === 'text')
        .map((block: ContentBlock) => block.text || '')
        .join('\n');
    }
    return '';
  }
}
