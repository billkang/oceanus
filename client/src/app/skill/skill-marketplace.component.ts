import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SkillService } from './skill.service';
import { formatRelativeTime } from '../utils/date';

@Component({
  selector: 'app-skill-marketplace',
  imports: [],
  standalone: true,
  template: `
    <div class="min-h-full flex flex-col">
      <main class="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div class="mb-8">
          <h2 class="text-2xl font-bold text-gray-900 tracking-tight">Skill 市场</h2>
          <p class="text-sm text-gray-500 mt-1">浏览可用的 AI 技能，了解每个 Skill 的 功能和使用方式</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (skill of skills; track skill.id) {
            <div
              (click)="goDetail(skill.id)"
              (keydown.enter)="goDetail(skill.id)"
              tabindex="0"
              role="button"
              class="group bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6
                hover:shadow-xl hover:shadow-indigo-500/5 hover:border-indigo-200
                  transition-all duration-300 cursor-pointer"
            >
              <div class="flex items-start gap-4">
                <div
                  class="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br
                  from-indigo-50 to-violet-50 flex items-center justify-center border border-indigo-100"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-indigo-500"
                  >
                    <path
                      d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015
                      1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414
                      L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015
                      1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0
                      L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015
                      1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414
                      L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015
                      1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"
                    />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-gray-900 text-lg">{{ skill.name }}</h3>
                  <p class="text-sm text-gray-500 mt-1 line-clamp-2">{{ skill.description }}</p>
                </div>
              </div>

              <div class="mt-4 pt-4 border-t border-indigo-50 flex items-center justify-between">
                <div class="flex items-center gap-3 text-xs text-gray-400">
                  <span>{{ skill.createdBy }}</span>
                  <span>·</span>
                  <span>{{ formatRelativeTime(skill.updatedAt) }}</span>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
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
export class SkillMarketplaceComponent {
  private readonly skillService = inject(SkillService);
  private readonly router = inject(Router);

  readonly skills = this.skillService.list();
  protected readonly formatRelativeTime = formatRelativeTime;

  goDetail(id: string): void {
    this.router.navigateByUrl(`/skills/${id}`);
  }
}
