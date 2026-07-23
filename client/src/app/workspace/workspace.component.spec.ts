import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { WorkspaceComponent } from './workspace.component';

describe('WorkspaceComponent', () => {
  let fixture: any;
  let component: WorkspaceComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkspaceComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('应创建组件', () => {
    expect(component).toBeTruthy();
  });

  it('左侧面板默认展开', () => {
    expect(component.leftCollapsed()).toBe(false);
  });

  it('右侧面板默认展开', () => {
    expect(component.rightCollapsed()).toBe(false);
  });

  it('切换左侧面板应改变折叠状态', () => {
    component.toggleLeft();
    expect(component.leftCollapsed()).toBe(true);
    component.toggleLeft();
    expect(component.leftCollapsed()).toBe(false);
  });

  it('切换右侧面板应改变折叠状态', () => {
    component.toggleRight();
    expect(component.rightCollapsed()).toBe(true);
    component.toggleRight();
    expect(component.rightCollapsed()).toBe(false);
  });

  it('onCreateSession 应设置 activeSessionId 为 __new__', () => {
    expect(component.activeSessionId()).toBe('');
    component.onCreateSession();
    expect(component.activeSessionId()).toBe('__new__');
  });

  it('onSessionCreated 应更新 activeSessionId', () => {
    component.onSessionCreated('sdk-new-42');
    expect(component.activeSessionId()).toBe('sdk-new-42');
  });

  it('onSessionRemoved 应清除当前选中状态', () => {
    component.onSessionCreated('sdk-current');
    expect(component.activeSessionId()).toBe('sdk-current');

    component.onSessionRemoved('sdk-current');
    expect(component.activeSessionId()).toBe('');
  });

  it('onSessionRemoved 仅清除匹配的会话', () => {
    component.onSessionCreated('sdk-current');
    component.onSessionRemoved('sdk-other');
    expect(component.activeSessionId()).toBe('sdk-current');
  });
});
