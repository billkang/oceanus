import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

type FileTab = 'docs' | 'code';

@Component({
  selector: 'app-file-panel',
  standalone: true,
  template: `
    <div class="flex flex-col h-full">
      <!-- Tab bar: 文档 / 代码 -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-indigo-50">
        <div class="flex items-center gap-1">
          <button
            type="button"
            (click)="activeTab.set('docs')"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            [class.bg-indigo-50]="activeTab() === 'docs'"
            [class.text-indigo-600]="activeTab() === 'docs'"
            [class.text-gray-400]="activeTab() !== 'docs'"
            [class.hover:text-gray-600]="activeTab() !== 'docs'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706
                l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>
              <path d="M14 2v5a1 1 0 0 0 1 1h5"/>
              <path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
            </svg>
            文档
          </button>
          <button
            type="button"
            (click)="activeTab.set('code')"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            [class.bg-indigo-50]="activeTab() === 'code'"
            [class.text-indigo-600]="activeTab() === 'code'"
            [class.text-gray-400]="activeTab() !== 'code'"
            [class.hover:text-gray-600]="activeTab() !== 'code'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>
            </svg>
            代码
          </button>
        </div>
      </div>

      <!-- Action bar: 新建文件夹 / 上传 -->
      <div class="flex items-center gap-1 px-3 py-2 border-b border-indigo-50">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 text-xs text-gray-500
            hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          title="新建文件夹"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 10v6"/><path d="M9 13h6"/>
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9
              L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
          </svg>
          新建文件夹
        </button>
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 text-xs text-gray-500
            hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          title="上传文件"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          </svg>
          上传
        </button>
        <div class="flex-1"></div>
      </div>

      <!-- File list / empty state -->
      <div class="flex-1 overflow-y-auto py-1">
        <div class="text-center py-8 px-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" class="mx-auto text-gray-300 mb-2">
            <path d="M5 12h14"/><path d="M12 5v14"/>
          </svg>
          <p class="text-xs text-gray-400">暂无文件</p>
          <p class="text-xs text-gray-400 mt-0.5">点击"新建文件夹"或"上传"开始</p>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilePanelComponent {
  readonly activeTab = signal<FileTab>('docs');
}
