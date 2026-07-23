import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface NavItem {
  id: string;
  label: string;
  iconSvg: string;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

@Component({
  selector: 'app-nav-sidebar',
  imports: [],
  standalone: true,
  template: `
    <aside class="w-56 flex-shrink-0 bg-white/60 backdrop-blur-xl border-r border-indigo-100/50 flex flex-col h-full">
      <!-- Logo -->
      <div class="px-5 py-4">
        <div class="flex items-center gap-2.5">
          <div class="flex items-center justify-center w-8 h-8 rounded-xl
                      bg-gradient-to-br from-indigo-500 to-violet-500 text-white
                      shadow-lg shadow-indigo-500/20">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02
                     A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46
                     l1.92-6.02A1 1 0 0 0 11 14z"/>
            </svg>
          </div>
          <span class="font-bold text-gray-900 tracking-tight text-lg">Oceanus</span>
        </div>
      </div>

      <!-- 分隔线 -->
      <div class="px-5 py-2">
        <div class="h-px bg-gradient-to-r from-indigo-100/50 to-transparent"></div>
      </div>

      <!-- 导航 -->
      <nav class="flex-1 px-3 py-2 space-y-4 overflow-y-auto">
        @for (group of navGroups(); track group.label ?? $index) {
          <div>
            @if (group.label) {
              <div class="px-3 mb-1.5">
                <span class="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                  {{ group.label }}
                </span>
              </div>
            }
            <ul class="space-y-0.5">
              @for (item of group.items; track item.id) {
                <li>
                  <button
                    type="button"
                    class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-200"
                    [class.!bg-indigo-50]="activeId() === item.id"
                    [class.!text-indigo-600]="activeId() === item.id"
                    [class.!font-medium]="activeId() === item.id"
                    [class.!shadow-sm]="activeId() === item.id"
                    [class.text-gray-500]="activeId() !== item.id"
                    [class.hover:text-gray-700]="activeId() !== item.id"
                    [class.hover:bg-gray-50]="activeId() !== item.id"
                    (click)="navigate.emit(item.id)"
                    (keydown.enter)="navigate.emit(item.id)"
                  >
                    <span
                      class="flex-shrink-0"
                      [class.text-indigo-500]="activeId() === item.id"
                      [class.text-gray-400]="activeId() !== item.id"
                      [innerHTML]="item.iconSvg"
                    ></span>
                    <span>{{ item.label }}</span>
                  </button>
                </li>
              }
            </ul>
          </div>
        }
      </nav>
    </aside>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavSidebarComponent {
  readonly navGroups = input<NavGroup[]>([]);
  readonly activeId = input<string>('');
  readonly navigate = output<string>();
}
