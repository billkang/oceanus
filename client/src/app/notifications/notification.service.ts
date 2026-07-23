import { Injectable, signal } from '@angular/core';

export interface Notification {
  id: number;
  severity: 'error' | 'warn' | 'info' | 'success';
  summary: string;
  detail: string;
  autoCloseMs?: number;
}

let nextId = 0;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly notifications = signal<Notification[]>([]);

  private add(severity: Notification['severity'], summary: string, detail: string, autoCloseMs?: number): void {
    const id = ++nextId;
    this.notifications.update(list => [...list,
      { id, severity, summary, detail, autoCloseMs },
    ]);
    if (autoCloseMs && autoCloseMs > 0) {
      setTimeout(() => this.dismiss(id), autoCloseMs);
    }
  }

  error(summary: string, detail = ''): void {
    this.add('error', summary, detail, 8000);
  }

  warn(summary: string, detail = ''): void {
    this.add('warn', summary, detail, 6000);
  }

  info(summary: string, detail = ''): void {
    this.add('info', summary, detail, 4000);
  }

  success(summary: string, detail = ''): void {
    this.add('success', summary, detail, 4000);
  }

  dismiss(id: number): void {
    this.notifications.update(list => list.filter(n => n.id !== id));
  }

  clear(): void {
    this.notifications.set([]);
  }
}
