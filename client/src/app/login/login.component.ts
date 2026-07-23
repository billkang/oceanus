import type { HttpErrorResponse } from '@angular/common/http';
import type { OnDestroy } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject, signal, type OnInit } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormField, InputText, Button],
  standalone: true,
  templateUrl: 'login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly model = signal({ username: '', password: '' });
  readonly loginForm = form(this.model);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly focusedField = signal<'username' | 'password' | null>(null);
  readonly mounted = signal(false);
  readonly cursorVisible = signal(true);

  private blinkTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/projects');
      return;
    }

    setTimeout(() => this.mounted.set(true), 50);

    this.blinkTimer = setInterval(() => {
      this.cursorVisible.update(v => !v);
    }, 530);
  }

  ngOnDestroy(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
    }
  }

  login(): void {
    if (this.loading()) return;
    this.error.set('');

    // 从表单控件读取值，而非直接从 model 信号读取，
    // 避免信号表单 URL 序列化导致的同步问题
    const formValue = this.loginForm().value();
    const username = formValue.username ?? '';
    const password = formValue.password ?? '';
    if (!username.trim() || !password.trim()) {
      this.error.set('请填写用户名和密码');
      return;
    }

    this.loading.set(true);

    this.auth.login(username.trim(), password).subscribe({
      next: () => {
        this.router.navigateByUrl('/projects');
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(err.status === 401 ? '用户名或密码错误' : '登录失败，请稍后重试');
        this.loading.set(false);
      },
    });
  }
}
