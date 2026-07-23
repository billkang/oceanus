import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';

@Component({
  selector: 'app-not-found',
  imports: [Button, Card],
  standalone: true,
  template: `
    <div class="flex items-center justify-center min-h-screen bg-surface-50">
      <p-card class="w-full max-w-sm mx-4 text-center">
        <div class="flex flex-col items-center gap-4 py-4">
          <span class="text-6xl font-bold text-surface-300">404</span>
          <h2 class="text-xl font-semibold text-surface-700">页面未找到</h2>
          <p class="text-surface-500">您访问的页面不存在或已被移除</p>
          <p-button
            label="返回首页"
            icon="pi pi-home"
            (onClick)="goHome()"
            data-testid="not-found-home"
          />
        </div>
      </p-card>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {
  private readonly router = inject(Router);

  goHome(): void {
    this.router.navigateByUrl('/projects');
  }
}
