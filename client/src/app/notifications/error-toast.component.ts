import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from 'primeng/button';
import { NotificationService, type Notification } from './notification.service';

@Component({
  selector: 'app-error-toast',
  imports: [Button],
  standalone: true,
  template: `
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      @for (n of notifications(); track n.id) {
        <div
          class="rounded-lg shadow-lg px-4 py-3 text-sm font-medium
                 flex items-start gap-2 animate-slide-in cursor-pointer"
          [class]="bgClass(n.severity)"
          (click)="dismiss(n.id)"
          (keydown.enter)="dismiss(n.id)"
          role="alert"
        >
          <span class="flex-1">
            <span class="font-semibold">{{ n.summary }}</span>
            @if (n.detail) {
              <span class="block text-xs mt-0.5 opacity-90">{{ n.detail }}</span>
            }
          </span>
          <p-button
            [text]="true" [rounded]="true" severity="secondary"
            styleClass="text-current opacity-60 hover:opacity-100 text-lg leading-none"
          >&times;</p-button>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .animate-slide-in { animation: slideIn 0.3s ease-out; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorToastComponent {
  private readonly notificationService = inject(NotificationService);
  readonly notifications = this.notificationService.notifications;

  dismiss(id: number): void {
    this.notificationService.dismiss(id);
  }

  bgClass(severity: Notification['severity']): string {
    switch (severity) {
      case 'error': return 'bg-red-600 text-white';
      case 'warn': return 'bg-amber-500 text-white';
      case 'success': return 'bg-indigo-600 text-white';
      case 'info': return 'bg-blue-600 text-white';
    }
  }
}
