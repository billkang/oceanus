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
});
