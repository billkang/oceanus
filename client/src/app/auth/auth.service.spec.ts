import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AuthService,
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('login 应 POST /api/v1/auth/login 并存储 token', () => {
    service.login('admin', 'oceanus123').subscribe((res) => {
      expect(res.token).toBe('test-jwt-token');
      expect(res.user.username).toBe('admin');
      expect(localStorage.getItem('oceanus_token')).toBe('test-jwt-token');
    });

    const req = httpMock.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'oceanus123' });
    req.flush({ token: 'test-jwt-token', user: { id: 1, username: 'admin', displayName: 'Admin' } });
  });

  it('getToken 应返回 localStorage 中的 token', () => {
    localStorage.setItem('oceanus_token', 'stored-token');
    expect(service.getToken()).toBe('stored-token');
  });

  it('isLoggedIn 应在有 token 时返回 true', () => {
    localStorage.setItem('oceanus_token', 'token');
    expect(service.isLoggedIn()).toBe(true);
  });

  it('isLoggedIn 应在无 token 时返回 false', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('logout 应清除 token 和 user 信息', () => {
    localStorage.setItem('oceanus_token', 'token');
    localStorage.setItem('oceanus_user', JSON.stringify({ id: 1, username: 'admin' }));
    service.logout();
    expect(localStorage.getItem('oceanus_token')).toBeNull();
    expect(localStorage.getItem('oceanus_user')).toBeNull();
  });

  it('getUser 应返回反序列化的用户信息', () => {
    const user = { id: 1, username: 'admin', displayName: 'Admin' };
    localStorage.setItem('oceanus_user', JSON.stringify(user));
    expect(service.getUser()).toEqual(user);
  });

  it('getUser 应在无数据时返回 null', () => {
    expect(service.getUser()).toBeNull();
  });
});
