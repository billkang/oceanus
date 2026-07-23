import { ChangeDetectionStrategy, Component, signal, effect, inject, viewChild, type OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { SessionListComponent } from '../session/session-list.component';
import { AuthService } from '../auth/auth.service';
import { ChatComponent } from '../chat/chat.component';
import { FilePanelComponent } from '../file-panel/file-panel.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';
import type { User } from '../auth/auth.service';

const LS_KEY_LEFT = 'oceanus_workspace_left_collapsed';
const LS_KEY_RIGHT = 'oceanus_workspace_right_collapsed';

@Component({
  selector: 'app-workspace',
  imports: [SessionListComponent, ChatComponent, FilePanelComponent, Button, UserMenuComponent],
  standalone: true,
  template: `
    <div class="h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50/20">
      <!-- ===== 顶部栏 ===== -->
      <header class="h-12 glass border-b border-indigo-100/30 flex items-center justify-between px-4 flex-shrink-0 relative z-[1]">
        <div class="flex items-center gap-3">
          <p-button
            (onClick)="onBackToProjects()"
            [text]="true"
            [rounded]="true"
            styleClass="!text-gray-500 hover:!text-gray-700 !text-sm !p-1"
            ariaLabel="返回工作台"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
            </svg>
            <span class="hidden sm:inline ml-1">返回工作台</span>
          </p-button>
          <div class="w-px h-5 bg-indigo-100"></div>
          <h1 class="font-semibold text-gray-900 text-sm truncate max-w-[300px]">
            {{ projectName }}
          </h1>
        </div>

        <div class="relative">
          @if (currentUser(); as user) {
            <app-user-menu [user]="user" [compact]="true" (logout)="onLogout()" />
          }
        </div>
      </header>

      <!-- ======== Body: three-column layout ======== -->
      <div class="flex-1 flex min-h-0 overflow-hidden">
        <!-- Left panel: Session list (280px) -->
        <aside
          class="w-[280px] bg-white/50 backdrop-blur-sm border-r border-indigo-100/30
                 flex flex-col flex-shrink-0 transition-all duration-300 overflow-y-auto"
          [class.!w-0]="leftCollapsed()"
        >
          @if (!leftCollapsed()) {
            <app-session-list
              [projectId]="projectId"
              (create)="onCreateSession()"
              (sessionSelect)="onSelectSession($event)"
              (sessionRemoved)="onSessionRemoved($event)"
              (collapseToggle)="toggleLeft()"
            />
          }
        </aside>

        <!-- Center panel: Chat area -->
        <div class="flex-1 flex flex-col min-w-0 overflow-hidden bg-gradient-to-b from-white/40 to-white/60">
          @if (activeSessionId()) {
            <!-- Active session chat -->
            <app-chat
              class="flex-1 min-h-0 flex flex-col"
              [sessionId]="activeSessionId()"
              [projectId]="projectId"
              (assetReady)="onAssetReady($event)"
              (titleUpdated)="onTitleUpdated($event)"
              (sessionCreated)="onSessionCreated($event)"
            />
          } @else {
            <!-- Welcome screen: expert selection -->
            <div class="flex-1 overflow-y-auto">
              <div class="flex flex-col items-center justify-center py-12 px-8 text-center">
                <div class="icon-box icon-box-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600
                            shadow-xl shadow-indigo-500/20 mb-5">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    class="text-white"
                  >
                    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02
                           A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46
                           l1.92-6.02A1 1 0 0 0 11 14z"/>
                  </svg>
                </div>
                <h2 class="text-xl font-bold text-gray-900 mb-2">欢迎来到「{{ projectName }}」</h2>
                <p class="text-sm text-gray-500 mb-8">在开始之前，请选择本次会话使用的专家</p>

                <div class="w-full max-w-md space-y-2 mb-8">
                  <!-- Expert card -->
                  <button
                    type="button"
                    class="w-full flex items-start gap-3 p-4 rounded-xl border-2 transition-all duration-200 text-left"
                    [class.border-indigo-400]="selectedExpert() === 'product'"
                    [class.bg-indigo-50/60]="selectedExpert() === 'product'"
                    [class.shadow-md]="selectedExpert() === 'product'"
                    [class.shadow-indigo-500/10]="selectedExpert() === 'product'"
                    [class.border-gray-200]="selectedExpert() !== 'product'"
                    [class.bg-white]="selectedExpert() !== 'product'"
                    [class.hover:border-indigo-300]="selectedExpert() !== 'product'"
                    [class.hover:bg-indigo-50/30]="selectedExpert() !== 'product'"
                    (click)="selectedExpert.set('product')"
                    (keydown.enter)="selectedExpert.set('product')"
                    (keydown.space)="selectedExpert.set('product')"
                  >
                    <div class="flex-shrink-0 w-10 h-10 rounded-xl icon-box icon-box-md
                                bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/20">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                      >
                        <path d="M12 8V4H8"/>
                        <rect width="16" height="12" x="4" y="8" rx="2"/>
                        <path d="M2 14h2"/><path d="M20 14h2"/>
                        <path d="M15 13v2"/><path d="M9 13v2"/>
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-sm text-indigo-700">产品专家</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">deepseek-v4-pro</span>
                      </div>
                      <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        为产品经理提供从想法到 PRD 的全流程 AI 协作能力
                      </p>
                    </div>
                    <div class="flex-shrink-0 mt-1.5 w-5 h-5 rounded-full border-2
                                flex items-center justify-center transition-colors"
                      [class.border-indigo-500]="selectedExpert() === 'product'"
                      [class.bg-indigo-500]="selectedExpert() === 'product'"
                      [class.border-gray-300]="selectedExpert() !== 'product'"
                    >
                      @if (selectedExpert() === 'product') {
                        <div class="w-2 h-2 rounded-full bg-white"></div>
                      }
                    </div>
                  </button>
                </div>

                <p-button
                  (onClick)="onCreateSession()"
                  styleClass="btn-gradient !px-6 !py-2.5"
                >
                  开始对话
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  >
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </p-button>
                <p class="text-xs text-gray-400 mt-4">
                  选择后，本次会话将锁定该专家，后续不可切换
                </p>
              </div>
            </div>
          }
        </div>

        <!-- Right panel: File panel -->
        <aside
          class="bg-white/50 backdrop-blur-sm border-l border-indigo-100/30
                 flex flex-col flex-shrink-0 transition-all duration-300 overflow-y-auto w-[320px]"
          [class.!w-0]="rightCollapsed()"
        >
          @if (!rightCollapsed()) {
            <app-file-panel />
          }
        </aside>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);

  readonly leftCollapsed = signal(localStorage.getItem(LS_KEY_LEFT) === 'true');
  readonly rightCollapsed = signal(localStorage.getItem(LS_KEY_RIGHT) === 'true');
  readonly activeSessionId = signal('');
  readonly activeNumericSessionId = signal(0);
  readonly assetRefreshKey = signal(0);
  readonly currentUser = signal<User | null>(null);
  readonly selectedExpert = signal<string | null>('product');
  readonly sessionListComp = viewChild(SessionListComponent);
  readonly chatComp = viewChild(ChatComponent);

  projectId = 0;
  projectName = '';

  constructor() {
    effect(() => {
      localStorage.setItem(LS_KEY_LEFT, String(this.leftCollapsed()));
    });
    effect(() => {
      localStorage.setItem(LS_KEY_RIGHT, String(this.rightCollapsed()));
    });

    this.currentUser.set(this.authService.getUser());
  }

  ngOnInit(): void {
    this.route.params.subscribe((p) => {
      this.projectId = Number(p['projectId']);
      this.loadProjectName();
    });
  }

  private loadProjectName(): void {
    this.projectName = '智能客服系统';
  }

  onCreateSession(): void {
    this.activeSessionId.set('__new__');
    this.activeNumericSessionId.set(0);
  }

  onSelectSession(sdkSessionId: string): void {
    this.activeSessionId.set(sdkSessionId);
    const numericId = this.sessionListComp()?.sessions().find(s => s.sdkSessionId === sdkSessionId)?.id ?? 0;
    this.activeNumericSessionId.set(numericId);
  }

  onSessionCreated(sdkSessionId: string): void {
    this.activeSessionId.set(sdkSessionId);
    this.activeNumericSessionId.set(0);
    this.sessionListComp()?.loadSessions();
  }

  onSessionRemoved(sdkSessionId: string): void {
    if (this.activeSessionId() === sdkSessionId) {
      this.activeSessionId.set('');
      this.activeNumericSessionId.set(0);
    }
  }

  onBackToProjects(): void {
    this.router.navigateByUrl('/projects');
  }

  onLogout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  onAssetReady(_assetId: number): void {
    void _assetId;
    this.assetRefreshKey.update(k => k + 1);
  }

  onTitleUpdated(data: { sdkSessionId: string; title: string }): void {
    this.sessionListComp()?.updateSessionTitle(data.sdkSessionId, data.title);
  }

  toggleLeft(): void {
    this.leftCollapsed.update(v => !v);
  }

  toggleRight(): void {
    this.rightCollapsed.update(v => !v);
  }
}
