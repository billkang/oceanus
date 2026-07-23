import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { User } from '../auth/auth.service';

@Component({
  selector: 'app-user-menu',
  standalone: true,
  template: `
    <div class="relative">
      <button
        #toggleBtn
        type="button"
        (click)="toggle()"
        class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm
               text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <div class="flex items-center justify-center w-6 h-6 rounded-full
                    bg-gradient-to-br from-indigo-400 to-violet-500
                    text-white text-[10px] font-semibold">
          {{ userInitial() }}
        </div>
        <span
          class="whitespace-nowrap"
          [class.hidden]="compact()"
          [class.sm:inline]="compact()"
        >
          {{ user().displayName || user().username }}
        </span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="text-gray-400 transition-transform flex-shrink-0"
          [class.rotate-180]="open()"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      @if (open()) {
        <div
          class="absolute top-full right-0 mt-1 z-20 bg-white rounded-xl
                 shadow-xl border border-gray-100 py-1 min-w-[140px] overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <button
            type="button"
            (click)="onLogout()"
            class="w-full flex items-center gap-2 px-3 py-2 text-sm
                   text-red-500 hover:bg-red-50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            退出登录
          </button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserMenuComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly user = input.required<User>();
  /** 紧凑模式：小屏隐藏用户名，sm+ 恢复显示 */
  readonly compact = input(false);
  readonly logout = output<void>();

  readonly open = signal(false);

  readonly userInitial = computed(() => {
    const u = this.user();
    return (u.displayName || u.username || '?').charAt(0).toUpperCase();
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Close if click is outside this component's DOM
    const host = this.elementRef.nativeElement;
    if (!host.contains(target)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }

  toggle(): void {
    this.open.update(v => !v);
  }

  onLogout(): void {
    this.open.set(false);
    this.logout.emit();
  }
}
