import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { WorkspaceComponent } from './workspace.component';
import { ProjectService } from '../project/project.service';

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

describe('项目标题加载（回归：OnPush 组件异步赋值必须走 signal）', () => {
  let mockGetById: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    mockGetById = vi.fn();
    mockGetById.mockReturnValue(
      of({ id: 1, projectName: 'project-a', displayName: '项目A', sessionCount: 0, createdAt: '', updatedAt: '' }),
    );
    await TestBed.configureTestingModule({
      imports: [WorkspaceComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of({ projectName: 'project-a' }) } },
        { provide: ProjectService, useValue: { getById: mockGetById } },
      ],
    }).compileComponents();
  });

  it('projectName 为 signal，路由参数映射到顶栏（模板以 projectName() 读取）', () => {
    const fix = TestBed.createComponent(WorkspaceComponent);
    const comp = fix.componentInstance;
    fix.detectChanges();
    expect(comp.projectName()).toBe('project-a');
  });

  it('projectTitle 成功加载后为 displayName（OnPush 由 signal 触发渲染）', () => {
    mockGetById.mockReturnValue(
      of({ id: 1, projectName: 'project-a', displayName: '项目A', sessionCount: 0, createdAt: '', updatedAt: '' }),
    );
    const fix = TestBed.createComponent(WorkspaceComponent);
    const comp = fix.componentInstance;
    fix.detectChanges();
    expect(comp.projectTitle()).toBe('项目A');
  });

  it('projectTitle 加载失败时降级为 projectName', () => {
    mockGetById.mockReturnValue(throwError(() => new Error('404')));
    const fix = TestBed.createComponent(WorkspaceComponent);
    const comp = fix.componentInstance;
    fix.detectChanges();
    expect(comp.projectTitle()).toBe('project-a');
  });
});
