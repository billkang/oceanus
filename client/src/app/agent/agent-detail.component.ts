import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { MarkdownRendererComponent } from '../markdown-renderer/markdown-renderer.component';
import { SkillService } from '../skill/skill.service';
import { AgentService } from './agent.service';

@Component({
  selector: 'app-agent-detail',
  imports: [Button, MarkdownRendererComponent],
  standalone: true,
  template: `
    @if (agent; as a) {
      <div class="min-h-full flex flex-col">
        <main class="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
          <!-- 返回按钮 -->
          <p-button
            (onClick)="goBack()"
            [link]="true"
            styleClass="!text-gray-500 hover:!text-gray-700 !p-0 mb-6"
            icon="pi pi-arrow-left"
            label="返回专家市场"
          />

          <!-- 基本信息卡片 -->
          <div class="bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6 mb-6">
            <div class="flex items-start gap-4">
              <div
                class="flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br
                from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20"
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
              </div>
              <div class="flex-1">
                <h1 class="text-2xl font-bold text-gray-900">{{ a.name }}</h1>
                <p class="text-sm text-gray-500 mt-1">{{ a.description }}</p>
                <div class="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  <span>创建人：{{ a.createdBy }}</span>
                  <span>更新：{{ formatDate(a.updatedAt) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 模型配置 -->
          <div class="bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6 mb-6">
            <div class="flex items-center gap-2 mb-3">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-indigo-500"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M15 2v2" />
                <path d="M15 20v2" />
                <path d="M2 15h2" />
                <path d="M20 15h2" />
              </svg>
              <h3 class="font-semibold text-gray-900">模型配置</h3>
            </div>
            <div
              class="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-lg
              text-sm text-indigo-600 font-medium"
            >
              {{ a.modelConfig }}
            </div>
          </div>
          <!-- 角色能力描述 -->
          <div class="bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6 mb-6">
            <h3 class="font-semibold text-gray-900 mb-4 text-lg">角色能力描述</h3>
            <div class="relative max-h-[420px] overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50 p-4">
              <app-markdown-renderer [content]="a.roleCapability" />
              <div
                class="sticky bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50/50
                to-transparent pointer-events-none -mb-4"
              ></div>
            </div>
          </div>

          <!-- 关联 Skill -->
          <div class="bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6">
            <div class="flex items-center gap-2 mb-4">
              <svg
                width="18"
                height="18"
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
              <h3 class="font-semibold text-gray-900 text-lg">关联 Skill</h3>
              <span class="text-xs text-gray-400">({{ relatedSkills.length }})</span>
            </div>

            @if (relatedSkills.length === 0) {
              <p class="text-sm text-gray-400">暂无关联 Skill</p>
            } @else {
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                @for (skill of relatedSkills; track skill.id) {
                  <div
                    (click)="goSkill(skill.id)"
                    (keydown.enter)="goSkill(skill.id)"
                    tabindex="0"
                    role="button"
                    class="flex items-start gap-3 p-4 rounded-xl bg-gray-50/80 border border-gray-100
                      cursor-pointer hover:bg-gray-100 transition-colors"
                  >
                    <div class="flex-shrink-0 w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
                      <svg
                        width="16"
                        height="16"
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
                      <h4 class="text-sm font-medium text-gray-900">{{ skill.name }}</h4>
                      <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{{ skill.description }}</p>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </main>
      </div>
    } @else {
      <!-- 专家不存在 -->
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="mx-auto mb-4 text-gray-300"
          >
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          <h2 class="text-xl font-semibold text-gray-900">专家不存在</h2>
          <p class="text-sm text-gray-500 mt-1">未找到该专家的信息</p>
          <p-button
            (onClick)="goBack()"
            styleClass="mt-4 !rounded-xl !bg-indigo-50 !text-indigo-600 hover:!bg-indigo-100 !border-0"
            icon="pi pi-arrow-left"
            label="返回专家市场"
          />
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agentService = inject(AgentService);
  private readonly skillService = inject(SkillService);

  readonly agent = this.getAgentFromRoute();
  readonly relatedSkills = this.agent ? this.skillService.getSkillsByIds(this.agent.relatedSkillIds) : [];

  private getAgentFromRoute() {
    const id = this.route.snapshot.paramMap.get('id');
    return id ? this.agentService.getById(id) : undefined;
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  }

  goBack(): void {
    this.router.navigateByUrl('/agents');
  }

  goSkill(id: string): void {
    this.router.navigateByUrl(`/skills/${id}`);
  }
}
