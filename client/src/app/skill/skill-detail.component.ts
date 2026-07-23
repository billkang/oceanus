import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { SkillService } from './skill.service';
import { MarkdownRendererComponent } from '../markdown-renderer/markdown-renderer.component';

@Component({
  selector: 'app-skill-detail',
  imports: [Button, MarkdownRendererComponent],
  standalone: true,
  template: `
    @if (skill; as s) {
      <div class="min-h-full flex flex-col">
        <main class="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
          <!-- 返回按钮 -->
          <p-button
            (onClick)="goBack()"
            [link]="true"
            styleClass="!text-gray-500 hover:!text-gray-700 !p-0 mb-6"
            icon="pi pi-arrow-left"
            label="返回 Skill 市场"
          />

          <!-- 基本信息卡片 -->
          <div class="bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6 mb-6">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br
                from-indigo-50 to-violet-50 flex items-center justify-center border border-indigo-100">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-500">
                  <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015
                    1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414
                    L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015
                    1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0
                    L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015
                    1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414
                    L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015
                    1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>
                </svg>
              </div>
              <div class="flex-1">
                <h1 class="text-2xl font-bold text-gray-900">{{ s.name }}</h1>
                <p class="text-sm text-gray-500 mt-1">{{ s.description }}</p>
                <div class="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  <span>创建人：{{ s.createdBy }}</span>
                  <span>更新：{{ formatDate(s.updatedAt) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 具体内容 -->
          <div class="bg-white/70 backdrop-blur-sm border border-indigo-100/50 rounded-2xl p-6">
            <h3 class="font-semibold text-gray-900 mb-4 text-lg">具体内容</h3>
            <div class="relative max-h-[420px] overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50 p-4">
              <app-markdown-renderer [content]="s.content" />
              <div class="sticky bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50/50
                to-transparent pointer-events-none -mb-4"></div>
            </div>
          </div>
        </main>
      </div>
    } @else {
      <!-- Skill 不存在 -->
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-gray-300">
            <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015
              1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414
              L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015
              1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0
              L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015
              1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414
              L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015
              1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>
          </svg>
          <h2 class="text-xl font-semibold text-gray-900">Skill 不存在</h2>
          <p class="text-sm text-gray-500 mt-1">未找到该 Skill 的信息</p>
          <p-button
            (onClick)="goBack()"
            styleClass="mt-4 !rounded-xl !bg-indigo-50 !text-indigo-600 hover:!bg-indigo-100 !border-0"
            icon="pi pi-arrow-left"
            label="返回 Skill 市场"
          />
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly skillService = inject(SkillService);

  readonly skill = this.getSkillFromRoute();

  private getSkillFromRoute() {
    const id = this.route.snapshot.paramMap.get('id');
    return id ? this.skillService.getById(id) : undefined;
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  }

  goBack(): void {
    this.router.navigateByUrl('/skills');
  }
}
