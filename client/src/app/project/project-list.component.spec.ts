import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectListComponent } from './project-list.component';

describe('ProjectListComponent', () => {
  let fixture: any;
  let component: ProjectListComponent;
  let httpMock: HttpTestingController;

  /** 创建组件并处理 ngOnInit 触发的初始请求 */
  async function createComponent(resp: any[] | 'error') {
    await TestBed.configureTestingModule({
      imports: [ProjectListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // flush ngOnInit request
    const req = httpMock.expectOne('/api/v1/projects');
    if (resp === 'error') {
      req.error(new ProgressEvent('Network error'));
    } else {
      req.flush(resp);
    }
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('应创建组件', async () => {
    await createComponent([]);
    expect(component).toBeTruthy();
  });

  it('应加载并展示项目列表', async () => {
    await createComponent([
      {
        id: 1, name: '项目1', description: '测试项目', sessionCount: 3,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      },
    ]);

    expect(component.projects().length).toBe(1);
    expect(component.loading()).toBe(false);
  });

  it('空状态时应显示提示', async () => {
    await createComponent([]);

    expect(component.projects().length).toBe(0);
    expect(component.projects().length).toBe(0);
  });

  it('加载错误时应显示错误信息', async () => {
    await createComponent('error');

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
  });

  it('点击创建按钮应打开对话框', async () => {
    await createComponent([]);

    expect(component.showCreateDialog()).toBe(false);
    component.openCreateDialog();
    expect(component.showCreateDialog()).toBe(true);
  });
});
