import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;
  let authService: AuthService;
  let router: Router;
  let http: HttpClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        AuthService,
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpClient);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('有 token 时应自动添加 Authorization 头', () => {
    localStorage.setItem('oceanus_token', 'test-jwt-token');

    http.get('/api/v1/auth/me').subscribe();

    const req = httpMock.expectOne('/api/v1/auth/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt-token');
    req.flush({});
  });

  it('无 token 时不应添加 Authorization 头', () => {
    http.get('/api/v1/test').subscribe();

    const req = httpMock.expectOne('/api/v1/test');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('收到 401 时应清除 token 并跳转到 /login', () => {
    localStorage.setItem('oceanus_token', 'expired-token');

    http.get('/api/v1/auth/me').subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/v1/auth/me');
    req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(localStorage.getItem('oceanus_token')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('登录接口的 401 不应触发跳转', () => {
    http.post('/api/v1/auth/login', {}).subscribe({
      error: () => {},
    });

    const req = httpMock.expectOne('/api/v1/auth/login');
    req.flush({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' });

    // 不应触发清除 token 和跳转
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
