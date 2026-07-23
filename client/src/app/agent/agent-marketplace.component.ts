import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { formatRelativeTime } from '../utils/date';
import { AgentService } from './agent.service';

@Component({
  selector: 'app-agent-marketplace',
  imports: [],
  standalone: true,
  template: `
    <div class="min-h-full flex flex-col">
      <main class="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div class="mb-8">
          <h2 class="text-2xl font-bold text-gray-900 tracking-tight">专家市场</h2>
          <p class="text-sm text-gray-500 mt-1">选择适合的 AI 专家，加速你的产品工作流</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (agent of agents; track agent.id) {
            <div
              (click)="goDetail(agent.id)"
              class="group bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6
                hover:shadow-xl hover:shadow-indigo-500/5 hover:border-indigo-200
                  transition-all duration-300 cursor-pointer"
            >
              <div class="flex items-start gap-4">
                <div class="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br
                  from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 8V4H8"/>
                    <rect width="16" height="12" x="4" y="8" rx="2"/>
                    <path d="M2 14h2"/>
                    <path d="M20 14h2"/>
                    <path d="M15 13v2"/>
                    <path d="M9 13v2"/>
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-gray-900 text-lg">{{ agent.name }}</h3>
                  <p class="text-sm text-gray-500 mt-1 line-clamp-2">{{ agent.description }}</p>
                </div>
              </div>

              <div class="mt-4 pt-4 border-t border-indigo-50 flex items-center justify-between">
                <div class="flex items-center gap-3 text-xs text-gray-400">
                  <span>{{ agent.createdBy }}</span>
                  <span>·</span>
                  <span>{{ formatRelativeTime(agent.updatedAt) }}</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  class="text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all"
                >
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </div>
            </div>
          }
        </div>
      </main>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentMarketplaceComponent {
  private readonly agentService = inject(AgentService);
  private readonly router = inject(Router);

  readonly agents = this.agentService.list();
  protected readonly formatRelativeTime = formatRelativeTime;

  goDetail(id: string): void {
    this.router.navigateByUrl(`/agents/${id}`);
  }
}
