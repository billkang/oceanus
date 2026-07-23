import { ɵSIGNAL } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DisplayMessage } from './chat-message.component';
import { ChatMessageComponent, MessageRole, MessageStatus } from './chat-message.component';

/**
 * 在 vitest JIT 环境中，Angular 不会自动注册 input() 信号为组件输入，
 * 导致 setInput 和模板绑定失效。通过直接设置 InputSignal 的内部节点值绕过此限制。
 */
/* eslint-disable no-param-reassign */
function setInputSignal<T>(target: unknown, name: string, value: T): void {
  (target as any)[name][ɵSIGNAL].value = value;
}
/* eslint-enable no-param-reassign */

describe('ChatMessageComponent', () => {
  async function setup(message: DisplayMessage) {
    await TestBed.configureTestingModule({
      imports: [ChatMessageComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(ChatMessageComponent);
    setInputSignal(fixture.componentInstance, 'message', message);
    fixture.detectChanges();
    return fixture;
  }

  it('应渲染用户消息（右对齐）', async () => {
    const fixture = await setup({
      id: '1',
      role: MessageRole.User,
      content: '你好',
      timestamp: Date.now(),
      status: MessageStatus.Complete,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('你好');
    expect(el.querySelector('.flex-row-reverse')).toBeTruthy();
  });

  it('应渲染助手消息（左对齐）', async () => {
    const fixture = await setup({
      id: '2',
      role: MessageRole.Assistant,
      content: '你好！有什么可以帮你？',
      timestamp: Date.now(),
      status: MessageStatus.Complete,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('你好！有什么可以帮你？');
    // 助手消息无 .flex-row-reverse（用户消息用 flex-row-reverse 切换左右）
    expect(el.querySelector('.flex-row-reverse')).toBeFalsy();
  });

  it('流式消息应显示闪烁光标', async () => {
    const fixture = await setup({
      id: '3',
      role: MessageRole.Assistant,
      content: '正在生成',
      timestamp: Date.now(),
      status: MessageStatus.Streaming,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.animate-wave-pulse')).toBeTruthy();
  });

  it('发送中状态应显示发送中提示', async () => {
    const fixture = await setup({
      id: '4',
      role: MessageRole.User,
      content: '测试消息',
      timestamp: Date.now(),
      status: MessageStatus.Sending,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('发送中...');
    expect(el.querySelector('.animate-spin')).toBeTruthy();
  });

  it('错误状态应显示错误信息', async () => {
    const fixture = await setup({
      id: '5',
      role: MessageRole.Assistant,
      content: '',
      timestamp: Date.now(),
      status: MessageStatus.Error,
      errorMessage: 'AI 服务异常',
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('AI 服务异常');
  });

  describe('选项按钮（确认交互）', () => {
    it('有选项时显示选项按钮', async () => {
      const fixture = await setup({
        id: '6',
        role: MessageRole.Assistant,
        content: '',
        timestamp: Date.now(),
        status: MessageStatus.Complete,
        options: ['A方案', 'B方案'],
        optionsText: '请选择方案',
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('请选择方案');
      expect(el.textContent).toContain('A方案');
      expect(el.textContent).toContain('B方案');
    });

    it('已选选项后显示已选择文字', async () => {
      const fixture = await setup({
        id: '7',
        role: MessageRole.Assistant,
        content: '',
        timestamp: Date.now(),
        status: MessageStatus.Complete,
        options: ['A方案', 'B方案'],
        selectedOption: 'A方案',
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('已选择');
    });

    it('点击选项应发射 optionSelect 事件', async () => {
      const fixture = await setup({
        id: '8',
        role: MessageRole.Assistant,
        content: '',
        timestamp: Date.now(),
        status: MessageStatus.Complete,
        options: ['A方案'],
      });
      const component = fixture.componentInstance;
      const spy = vi.fn();
      component.optionSelect.subscribe(spy);

      const buttons = fixture.nativeElement.querySelectorAll('button');
      const firstOptionBtn = Array.from<Element>(buttons).find(
        (b: Element) => b.textContent?.trim() === 'A方案',
      ) as HTMLElement;
      firstOptionBtn.click();

      expect(spy).toHaveBeenCalledWith('A方案');
    });

    it('用户消息错误时应显示重试按钮', async () => {
      const fixture = await setup({
        id: '10',
        role: MessageRole.User,
        content: '你好',
        timestamp: Date.now(),
        status: MessageStatus.Error,
        errorMessage: '发送失败',
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('发送失败');
      expect(el.textContent).toContain('重试');
    });

    it('点击重试按钮应发射 retry 事件', async () => {
      const fixture = await setup({
        id: '11',
        role: MessageRole.User,
        content: '你好',
        timestamp: Date.now(),
        status: MessageStatus.Error,
      });
      const component = fixture.componentInstance;
      const spy = vi.fn();
      component.retry.subscribe(spy);

      const retryBtn = Array.from<Element>(fixture.nativeElement.querySelectorAll('button')).find(
        (b: Element) => b.textContent?.trim() === '重试',
      ) as HTMLElement;
      retryBtn.click();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('选项按钮（确认交互）', () => {
    it('有选项时显示选项按钮', async () => {
      const fixture = await setup({
        id: '9',
        role: MessageRole.Assistant,
        content: '',
        timestamp: Date.now(),
        status: MessageStatus.Complete,
        options: ['A方案'],
      });
      const el = fixture.nativeElement as HTMLElement;
      const otherBtn = Array.from(el.querySelectorAll('button')).find(
        (b: Element) => b.textContent?.trim() === '其他...',
      ) as HTMLElement;

      expect(otherBtn).toBeTruthy();
      otherBtn.click();
      fixture.detectChanges();

      expect(el.querySelector('input')).toBeTruthy();
      expect(el.textContent).toContain('确认');
    });
  });
});
