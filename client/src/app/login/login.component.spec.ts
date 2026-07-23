import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: any;
  let component: LoginComponent;
  let router: Router;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'login', component: LoginComponent },
          { path: 'projects', component: LoginComponent }, // dummy route for navigation test
        ]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock?.verify();
  });

  it('应创建组件', () => {
    expect(component).toBeTruthy();
  });

  it('登录失败时应显示错误信息', () => {
    component.model.set({ username: 'wrong', password: 'wrong' });
    component.login();

    const req = httpMock.expectOne('/api/v1/auth/login');
    req.flush(
      { message: '账号或密码错误', statusCode: 401 },
      { status: 401, statusText: 'Unauthorized' },
    );

    fixture.detectChanges();
    expect(component.error()).toBe('用户名或密码错误');
  });

  it('登录成功时应跳转到 /projects', async () => {
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');
    component.model.set({ username: 'admin', password: 'oceanus123' });
    component.login();

    const req = httpMock.expectOne('/api/v1/auth/login');
    req.flush({ token: 'jwt', user: { id: 1, username: 'admin', displayName: 'Admin' } });

    // wait for async navigation
    await new Promise((r) => setTimeout(r, 0));
    expect(navigateSpy).toHaveBeenCalledWith('/projects');
  });

  it('加载时应禁用提交按钮', async () => {
    component.model.set({ username: 'admin', password: 'oceanus123' });
    component.login();

    // loading 应为 true
    expect(component.loading()).toBe(true);

    // 触发 HTTP 请求，验证按钮状态
    const req = httpMock.expectOne('/api/v1/auth/login');
    req.flush({ token: 'jwt', user: { id: 1, username: 'admin', displayName: 'Admin' } });
  });

  it('已登录用户访问 /login 时应跳转到 /projects', () => {
    localStorage.setItem('oceanus_token', 'existing-token');
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');

    // 重新创建组件，触发 ngOnInit
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith('/projects');
  });
});
