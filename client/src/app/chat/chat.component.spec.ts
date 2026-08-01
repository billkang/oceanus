import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ChatComponent } from './chat.component';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('应创建组件', () => {
    expect(component).toBeTruthy();
  });

  it('初始状态下 isStreaming 应为 false', () => {
    expect(component.isStreaming()).toBe(false);
  });

  it('输入为空时 canSend 应为 false', () => {
    expect(component.canSend()).toBe(false);
  });

  it('输入非空且非流式时 canSend 应为 true', () => {
    component.chatModel.set({ message: 'Hello' });
    fixture.detectChanges();
    expect(component.canSend()).toBe(true);
  });

  it('流式中 canSend 应为 false（即使输入非空）', () => {
    component.chatModel.set({ message: 'Hello' });
    component.isStreaming.set(true);
    fixture.detectChanges();
    expect(component.canSend()).toBe(false);
  });

  it('skills 列表应包含 6 个技能', () => {
    expect(component.skills.length).toBe(6);
    expect(component.skills[0].name).toBe('需求澄清');
  });

  it('选择技能应更新输入框内容', () => {
    component.onSkillSelect('PRD 生成');
    expect(component.chatModel().message).toBe('PRD 生成');
  });

  it('cancel 应停止流式状态', () => {
    component.isStreaming.set(true);
    component.cancel();
    expect(component.isStreaming()).toBe(false);
  });

  it('收到 turn_limit_reached 事件应显示轮次上限横幅', () => {
    (
      component as unknown as { handleSseEvent: (e: { type: string; data: Record<string, unknown> }) => void }
    ).handleSseEvent({ type: 'turn_limit_reached', data: { limit: 15 } });
    fixture.detectChanges();
    expect(component.limitNotice()).toContain('15');
  });

  it('收到 budget_limit_reached 事件应显示预算上限横幅', () => {
    (
      component as unknown as { handleSseEvent: (e: { type: string; data: Record<string, unknown> }) => void }
    ).handleSseEvent({ type: 'budget_limit_reached', data: { limit: 1 } });
    fixture.detectChanges();
    expect(component.limitNotice()).toContain('1.00');
  });

  it('limit 非数字时 budget 横幅应防御性降级而不抛错（F1）', () => {
    expect(() =>
      (
        component as unknown as { handleSseEvent: (e: { type: string; data: Record<string, unknown> }) => void }
      ).handleSseEvent({ type: 'budget_limit_reached', data: { limit: undefined } }),
    ).not.toThrow();
    expect(component.limitNotice()).toBeTruthy();
  });

  it('限额横幅应带 role="status" 供屏幕阅读器感知（F3）', () => {
    (
      component as unknown as { handleSseEvent: (e: { type: string; data: Record<string, unknown> }) => void }
    ).handleSseEvent({ type: 'turn_limit_reached', data: { limit: 15 } });
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  it('切换会话时应清空限额横幅（F2）', () => {
    component.limitNotice.set('已达到本次轮次上限（15 轮）');
    fixture.componentRef.setInput('sessionId', 'sdk-abc');
    fixture.detectChanges();
    expect(component.limitNotice()).toBe('');
  });

  it('重试时应清空限额横幅（F2）', () => {
    component.limitNotice.set('已达到本次预算上限（$1.00）');
    vi.spyOn((component as any).chatService, 'sendMessage').mockReturnValue(new AbortController());

    component.onRetry({
      id: 'user-1',
      role: 'user',
      content: '再试一次',
      timestamp: Date.now(),
      status: 'error',
      errorMessage: '失败',
    } as any);

    expect(component.limitNotice()).toBe('');
  });
});
