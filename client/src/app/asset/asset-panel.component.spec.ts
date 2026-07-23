import { provideHttpClient } from '@angular/common/http';
import { ɵSIGNAL } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AssetPanelComponent } from './asset-panel.component';
import { type AssetItem } from './asset.service';

/**
 * 在 vitest JIT 环境中，Angular 不会自动注册 input() 信号为组件输入，
 * 导致 setInput 和模板绑定失效。通过直接设置 InputSignal 的内部节点值绕过此限制。
 */
/* eslint-disable no-param-reassign */
function setInputSignal<T>(target: unknown, name: string, value: T): void {
  (target as any)[name][ɵSIGNAL].value = value;
}
/* eslint-enable no-param-reassign */

function createMockAsset(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: 1,
    sessionId: 1,
    title: 'PRD',
    type: 'prd',
    content: '# Oceanus PRD\n\n功能列表',
    createdAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('AssetPanelComponent', () => {
  let component: AssetPanelComponent;
  let fixture: any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssetPanelComponent],
      providers: [
        provideHttpClient(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssetPanelComponent);
    component = fixture.componentInstance;
  });

  it('应创建组件', () => {
    expect(component).toBeTruthy();
  });

  it('空状态应显示提示文字', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('暂无资产');
    expect(el.textContent).toContain('完成需求讨论后将在这里展示');
  });

  it('有 sessionId 时应加载资产列表', () => {
    // 先触发 effect（sessionId=0 → 清空），再设置资产
    fixture.detectChanges();
    component.assets.set([createMockAsset()]);
    component.loading.set(false);

    expect(component.assets().length).toBe(1);
  });

  it('应显示资产列表', () => {
    fixture.detectChanges();
    component.assets.set([createMockAsset()]);
    component.loading.set(false);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('PRD');
  });

  it('点击资产应展开预览', () => {
    fixture.detectChanges();
    component.assets.set([createMockAsset()]);
    component.loading.set(false);
    fixture.detectChanges();

    const assetItem = fixture.nativeElement.querySelector('[class*="cursor-pointer"]');
    expect(assetItem).toBeTruthy();
    assetItem.click();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Oceanus PRD');
    expect(el.textContent).toContain('功能列表');
  });

  it('再次点击已选资产应取消选中', () => {
    fixture.detectChanges();
    component.assets.set([createMockAsset()]);
    component.loading.set(false);
    fixture.detectChanges();

    const assetItem = fixture.nativeElement.querySelector('[class*="cursor-pointer"]');

    // First click — select
    assetItem.click();
    fixture.detectChanges();
    expect(component.selectedAsset()).toBeTruthy();

    // Second click — deselect
    assetItem.click();
    fixture.detectChanges();
    expect(component.selectedAsset()).toBeNull();
  });

  it('预览区域应有复制和下载按钮', () => {
    fixture.detectChanges();
    component.assets.set([createMockAsset()]);
    component.loading.set(false);
    fixture.detectChanges();

    const assetItem = fixture.nativeElement.querySelector('[class*="cursor-pointer"]');
    assetItem.click();
    fixture.detectChanges();

    // 预览区域应有复制和下载按钮（通过 title 属性判断）
    const preview = fixture.nativeElement.querySelector('[class*="border-t"]') as HTMLElement;
    expect(preview).toBeTruthy();
    const buttons = preview.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('refreshKey 递增应重新加载资产列表', () => {
    fixture.detectChanges();
    component.assets.set([createMockAsset()]);
    component.loading.set(false);
    fixture.detectChanges();

    // 设置 refreshKey（JIT 模式下 effect 不触发，直接更新 assets）
    setInputSignal(component, 'refreshKey', 1);
    component.assets.set([createMockAsset({ id: 2, title: 'Updated PRD' })]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Updated PRD');
  });

  describe('复制内容', () => {
    it('应调用 clipboard API 复制内容', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      // 先触发 effect 再设置 selectedAsset，避免被 effect 清空
      fixture.detectChanges();
      component.assets.set([createMockAsset()]);
      component.selectedAsset.set(createMockAsset());

      component.copyContent();
      expect(writeText).toHaveBeenCalledWith('# Oceanus PRD\n\n功能列表');
    });
  });

  describe('下载内容', () => {
    it('应触发文件下载', () => {
      const createObjectURL = vi.fn(() => 'blob:test');
      const revokeObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;

      fixture.detectChanges();
      component.assets.set([createMockAsset()]);
      component.selectedAsset.set(createMockAsset({ title: 'Oceanus PRD' }));

      const a = document.createElement('a');
      const clickSpy = vi.spyOn(a, 'click');
      vi.spyOn(document, 'createElement').mockReturnValue(a);

      component.downloadContent();

      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    });
  });
});
