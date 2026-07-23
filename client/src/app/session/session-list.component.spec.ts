import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { SessionListComponent } from './session-list.component';
import type { Session } from './session.service';

const mockSession = (overrides: Partial<Session> = {}): Session => ({
  id: 1,
  sdkSessionId: 'sdk-1',
  title: '会话1',
  status: 'active',
  filePath: null,
  lastMessageAt: null,
  projectId: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('SessionListComponent', () => {
  let fixture: any;
  let component: SessionListComponent;

  async function basicSetup() {
    await TestBed.configureTestingModule({
      imports: [SessionListComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('应创建组件', async () => {
    await basicSetup();
    expect(component).toBeTruthy();
  });

  it('初始状态为加载中', async () => {
    await basicSetup();
    expect(component.loading()).toBe(true);
  });

  it('空状态时应显示提示', async () => {
    await basicSetup();
    component.loading.set(false);
    fixture.detectChanges();
    expect(component.sessions().length).toBe(0);
    expect(component.isEmpty()).toBe(true);
  });

  it('应展示会话列表', async () => {
    await basicSetup();
    const sessions = [
      mockSession({ id: 1, sdkSessionId: 'sdk-1', title: '会话1' }),
      mockSession({ id: 2, sdkSessionId: 'sdk-2', title: '会话2' }),
    ];
    component.sessions.set(sessions);
    component.loading.set(false);
    fixture.detectChanges();
    expect(component.sessions().length).toBe(2);
  });

  it('应高亮当前会话（字符串 sdkSessionId）', async () => {
    await basicSetup();
    component.activeSessionId = 'sdk-abc';
    expect(component.isActive('sdk-abc')).toBe(true);
    expect(component.isActive('other-id')).toBe(false);
  });

  it('点击新建按钮应触发事件', async () => {
    await basicSetup();
    let emitted = false;
    component.create.subscribe(() => (emitted = true));
    component.createSession();
    expect(emitted).toBe(true);
  });
});
