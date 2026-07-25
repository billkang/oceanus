import { ChangeDetectionStrategy, Component, input, output, signal, effect, inject } from '@angular/core';
import { Button } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { NotificationService } from '../notifications/notification.service';
import type { Session } from './session.service';
import { SessionService } from './session.service';

@Component({
  selector: 'app-session-list',
  imports: [Button, ConfirmDialog],
  standalone: true,
  template: `
    <div class="h-full flex flex-col">
      <!-- New session button -->
      <div class="p-3">
        <p-button
          (onClick)="createSession()"
          styleClass="w-full !justify-center !gap-2 !px-4 !py-2.5 !text-sm !font-medium
            !bg-white/80 !backdrop-blur-sm !border !border-indigo-100/50
            !rounded-xl hover:!border-indigo-300 hover:!text-indigo-600
            hover:!shadow-md !transition-all !duration-200 !text-gray-700 !shadow-none"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          新建会话
        </p-button>
      </div>

      <!-- Divider -->
      <div class="px-3 pb-2">
        <div class="border-t border-indigo-50"></div>
      </div>

      <!-- Session list -->
      <div class="flex-1 overflow-y-auto px-1 pb-2 custom-scroll">
        @if (loading()) {
          <div class="p-3 space-y-1.5">
            @for (_ of [1, 2, 3]; track $index) {
              <div class="h-12 bg-indigo-50/50 rounded-xl animate-pulse"></div>
            }
          </div>
        } @else if (isEmpty()) {
          <!-- Session empty state -->
          <div class="text-center py-8 px-4">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="mx-auto text-indigo-200 mb-2"
            >
              <path
                d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586
                l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
              />
            </svg>
            <p class="text-xs text-gray-400">暂无历史会话</p>
            <p class="text-xs text-gray-400 mt-0.5">点击上方按钮开始新会话</p>
          </div>
        } @else {
          <!-- Session items -->
          <div class="space-y-0.5">
            @for (session of sessions(); track session.id) {
              <div
                class="group flex items-center gap-2 px-3 py-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-200"
                [class.bg-indigo-50/80]="isActive(session.sdkSessionId)"
                [class.text-indigo-700]="isActive(session.sdkSessionId)"
                [class.hover:bg-gray-50]="!isActive(session.sdkSessionId)"
                tabindex="0"
                role="button"
                (click)="selectSession(session.sdkSessionId)"
                (keydown.enter)="selectSession(session.sdkSessionId)"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="flex-shrink-0"
                  [class.text-indigo-500]="isActive(session.sdkSessionId)"
                  [class.text-gray-400]="!isActive(session.sdkSessionId)"
                >
                  <path
                    d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586
                    l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
                  />
                </svg>
                <span class="text-sm truncate flex-1">{{ session.title }}</span>

                @if (isActive(session.sdkSessionId)) {
                  <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                }

                <!-- 删除按钮（hover 时显示） -->
                <p-button
                  (onClick)="$event.stopPropagation(); deleteSession(session)"
                  styleClass="!w-6 !h-6 !p-0 !rounded-md !text-gray-400 hover:!text-red-500
                    hover:!bg-red-50 opacity-0 group-hover:opacity-100 !transition-all !duration-150
                    focus:opacity-100 [&_.p-button-label]:hidden"
                  title="删除会话"
                  severity="secondary"
                  [text]="true"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </p-button>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <p-confirmdialog />
  `,
  providers: [ConfirmationService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionListComponent {
  private readonly sessionService = inject(SessionService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly notificationService = inject(NotificationService);

  readonly projectId = input(0);
  readonly create = output<void>();
  readonly sessionSelect = output<string>();
  readonly sessionRemoved = output<string>();
  readonly collapseToggle = output<void>();

  readonly sessions = signal<Session[]>([]);
  readonly loading = signal(true);
  activeSessionId = '';

  constructor() {
    effect(() => {
      const pid = this.projectId();
      if (pid > 0) {
        this.loadSessions();
      }
    });
  }

  isEmpty(): boolean {
    return this.sessions().length === 0;
  }

  isActive(id: string): boolean {
    return this.activeSessionId === id;
  }

  loadSessions(): void {
    this.loading.set(true);
    this.sessionService.listByProject(this.projectId()).subscribe({
      next: (data) => {
        this.sessions.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  createSession(): void {
    this.create.emit();
  }

  selectSession(id: string): void {
    this.activeSessionId = id;
    this.sessionSelect.emit(id);
  }

  onCollapseToggle(): void {
    this.collapseToggle.emit();
  }

  updateSessionTitle(sdkSessionId: string, title: string): void {
    this.sessions.update((list) => {
      return list.map((s) => (s.sdkSessionId === sdkSessionId ? { ...s, title } : s));
    });
  }

  /** 删除会话（带确认弹窗） */
  deleteSession(session: Session): void {
    this.confirmationService.confirm({
      message: `确定要删除会话「${session.title}」吗？此操作不可撤销。`,
      header: '删除会话',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '删除',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'btn-secondary',
      accept: () => {
        this.sessionService.deleteBySdkSessionId(session.sdkSessionId).subscribe({
          next: () => {
            // 从本地列表移除
            this.sessions.update((list) => list.filter((s) => s.id !== session.id));
            // 如果删除的是当前活跃会话，通知父组件
            if (this.activeSessionId === session.sdkSessionId) {
              this.sessionRemoved.emit(session.sdkSessionId);
            }
            this.notificationService.success('会话已删除');
          },
          error: () => {
            this.notificationService.error('删除会话失败，请重试');
          },
        });
      },
    });
  }
}
