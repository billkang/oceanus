import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  let authService: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Router, useValue: { createUrlTree: vi.fn(() => 'redirect' as any) } },
      ],
    });
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    localStorage.clear();
  });

  it('已登录时应放行', () => {
    vi.spyOn(authService, 'isLoggedIn').mockReturnValue(true);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/projects' } as any),
    );
    expect(result).toBe(true);
  });

  it('未登录时应重定向到 /login 并携带 redirect 参数', () => {
    vi.spyOn(authService, 'isLoggedIn').mockReturnValue(false);
    TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/projects' } as any),
    );
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { redirect: '/projects' },
    });
  });
});
