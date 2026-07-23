import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Button } from 'primeng/button';
import { AssetService, type AssetItem } from './asset.service';

@Component({
  selector: 'app-asset-panel',
  imports: [DatePipe, Button],
  standalone: true,
  template: `
    <div class="h-full flex flex-col">
      <!-- Loading state -->
      @if (loading()) {
        <div class="flex-1 flex items-center justify-center p-4">
          <div class="space-y-2 w-full">
            @for (_ of [1, 2]; track $index) {
              <div class="h-14 bg-stone-100 rounded-xl animate-pulse"></div>
            }
          </div>
        </div>
      } @else if (assets().length === 0) {
        <!-- Empty state -->
        <div class="flex-1 flex flex-col items-center justify-center px-5 text-center">
          <div class="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
              class="text-slate-400">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <p class="text-sm text-stone-400">暂无资产</p>
          <p class="text-xs text-stone-300 mt-1">完成需求讨论后将在这里展示 PRD</p>
        </div>
      } @else {
        <!-- Asset list -->
        <div class="flex-1 overflow-y-auto custom-scroll">
          @for (asset of assets(); track asset.id) {
            <div
              class="px-4 py-2.5 border-b border-stone-100 cursor-pointer transition-all duration-200"
              [class.bg-gradient-to-r]="selectedAsset()?.id === asset.id"
              [class.from-ocean-surface]="selectedAsset()?.id === asset.id"
              [class.to-white]="selectedAsset()?.id === asset.id"
              [class.hover:bg-stone-50]="selectedAsset()?.id !== asset.id"
              tabindex="0"
              role="button"
              (click)="selectAsset(asset)"
              (keydown.enter)="selectAsset(asset)"
            >
              <div class="flex items-center gap-2.5">
                <!-- Type icon -->
                <div
                  class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  [class.bg-ocean-surface]="selectedAsset()?.id === asset.id"
                  [class.text-ocean-mid]="selectedAsset()?.id === asset.id"
                  [class.bg-stone-100]="selectedAsset()?.id !== asset.id"
                >
                  @if (asset.type === 'prd') {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  } @else {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  }
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-stone-700 truncate">{{ asset.title }}</p>
                  <p class="text-xs text-stone-400 mt-0.5">{{ asset.createdAt | date: 'MM/dd HH:mm' }}</p>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Preview panel -->
        @if (selectedAsset(); as sel) {
          <div class="border-t border-stone-200">
            <!-- Toolbar -->
            <div class="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-200">
              <span class="text-sm font-medium text-stone-700 truncate mr-2">{{ sel.title }}</span>
              <div class="flex gap-1 flex-shrink-0">
                <p-button
                  styleClass="p-1.5"
                  severity="secondary"
                  [text]="true"
                  [rounded]="true"
                  title="复制内容"
                  (onClick)="copyContent()"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </p-button>
                <p-button
                  styleClass="p-1.5"
                  severity="secondary"
                  [text]="true"
                  [rounded]="true"
                  title="下载 Markdown"
                  (onClick)="downloadContent()"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </p-button>
              </div>
            </div>
            <!-- Content -->
            <div class="p-4 overflow-y-auto max-h-72 text-sm text-stone-700
              whitespace-pre-wrap leading-relaxed custom-scroll markdown-content">
              @if (previewLoading()) {
                <div class="space-y-2">
                  <div class="h-3.5 bg-stone-200 rounded animate-pulse w-3/4"></div>
                  <div class="h-3.5 bg-stone-200 rounded animate-pulse w-1/2"></div>
                  <div class="h-3.5 bg-stone-200 rounded animate-pulse w-2/3"></div>
                </div>
              } @else {
                {{ sel.content }}
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetPanelComponent {
  private readonly assetService = inject(AssetService);

  readonly sessionId = input(0);
  readonly refreshKey = input(0);

  readonly assets = signal<AssetItem[]>([]);
  readonly selectedAsset = signal<AssetItem | null>(null);
  readonly loading = signal(false);
  readonly previewLoading = signal(false);

  constructor() {
    effect(() => {
      const sid = this.sessionId();
      void this.refreshKey();
      if (sid > 0) {
        this.loadAssets();
      } else {
        this.assets.set([]);
        this.selectedAsset.set(null);
      }
    });
  }

  private loadAssets(): void {
    this.loading.set(true);
    this.assetService.listBySession(this.sessionId()).subscribe({
      next: (data) => {
        this.assets.set(data);
        const sel = this.selectedAsset();
        if (sel && !data.find(a => a.id === sel.id)) {
          this.selectedAsset.set(null);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  selectAsset(asset: AssetItem): void {
    if (this.selectedAsset()?.id === asset.id) {
      this.selectedAsset.set(null);
      return;
    }
    this.selectedAsset.set(asset);
  }

  copyContent(): void {
    const sel = this.selectedAsset();
    if (!sel) return;

    navigator.clipboard.writeText(sel.content).catch(() => console.warn('Copy failed'));
  }

  downloadContent(): void {
    const sel = this.selectedAsset();
    if (!sel) return;

    const blob = new Blob([sel.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sel.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
