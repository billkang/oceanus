import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { NavSidebarComponent, type NavGroup } from '../nav-sidebar/nav-sidebar.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';

const SVG_BOT = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 8V4H8"/>
  <rect width="16" height="12" x="4" y="8" rx="2"/>
  <path d="M2 14h2"/><path d="M20 14h2"/>
  <path d="M15 13v2"/><path d="M9 13v2"/>
</svg>`;
const SVG_PUZZLE = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68
    l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015
    1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474
    2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61
    a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>
</svg>`;
const SVG_DASHBOARD = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect width="7" height="9" x="3" y="3" rx="1"/>
  <rect width="7" height="5" x="14" y="3" rx="1"/>
  <rect width="7" height="9" x="14" y="12" rx="1"/>
  <rect width="7" height="5" x="3" y="16" rx="1"/>
</svg>`;

@Component({
  selector: 'app-main-layout',
  imports: [NavSidebarComponent, RouterOutlet, UserMenuComponent],
  standalone: true,
  template: `
    <div class="min-h-screen flex bg-gradient-to-br from-slate-50 via-white to-indigo-50/20">
      <!-- ===== 侧边栏 ===== -->
      <app-nav-sidebar
        [navGroups]="navGroups"
        [activeId]="activeId()"
        (navigate)="onNavigate($event)"
      />

      <!-- ===== 右侧内容区 ===== -->
      <div class="flex-1 flex flex-col min-w-0 h-full">
        <!-- 顶部用户栏（右上角） -->
        <div class="h-12 flex items-center justify-end px-6 border-b border-indigo-100/30
                    bg-white/40 backdrop-blur-sm flex-shrink-0 relative z-[1]">
          @if (currentUser(); as user) {
            <app-user-menu [user]="user" (logout)="logout()" />
          }
        </div>

        <!-- 页面内容（由路由决定） -->
        <div class="flex-1 overflow-y-auto">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);
  private readonly auth = inject(AuthService);

  readonly activeId = signal('projects');
  readonly currentUser = signal(this.authService.getUser());

  readonly navGroups: NavGroup[] = [
    {
      items: [
        { id: 'agents', label: '专家市场', iconSvg: SVG_BOT },
        { id: 'skills', label: 'Skill 市场', iconSvg: SVG_PUZZLE },
      ],
    },
    {
      label: '工作台',
      items: [
        { id: 'projects', label: '工作台', iconSvg: SVG_DASHBOARD },
      ],
    },
  ];

  constructor() {
    const url = this.router.url;
    if (url.startsWith('/projects')) this.activeId.set('projects');
    else if (url.startsWith('/agents')) this.activeId.set('agents');
    else if (url.startsWith('/skills')) this.activeId.set('skills');
  }

  onNavigate(id: string): void {
    if (id === 'projects') {
      this.activeId.set('projects');
      this.router.navigateByUrl('/projects');
    } else if (id === 'agents') {
      this.activeId.set('agents');
      this.router.navigateByUrl('/agents');
    } else if (id === 'skills') {
      this.activeId.set('skills');
      this.router.navigateByUrl('/skills');
    }
  }

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
