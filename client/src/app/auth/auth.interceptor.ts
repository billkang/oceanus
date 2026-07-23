import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import type { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { NotificationService } from '../notifications/notification.service';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();
  const notifications = inject(NotificationService);

  let authReq = req;
  if (token) {
    authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !req.url.includes('/auth/login')) {
        auth.logout();
        router.navigateByUrl('/login');
      } else if (error.status === 0) {
        notifications.error('网络错误', '请检查网络连接后重试');
      } else if (error.status >= 500) {
        notifications.error('服务器错误', error.error?.message || '请稍后重试');
      }
      return throwError(() => error);
    }),
  );
};
