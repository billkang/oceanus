import { TestBed } from '@angular/core/testing';
import { ErrorToastComponent } from './error-toast.component';
import { NotificationService } from './notification.service';

describe('ErrorToastComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [ErrorToastComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(ErrorToastComponent);
    const component = fixture.componentInstance;
    const service = TestBed.inject(NotificationService);
    fixture.detectChanges();
    return { fixture, component, service };
  }

  it('应创建组件', async () => {
    const { component } = await setup();
    expect(component).toBeTruthy();
  });

  it('无通知时应不渲染内容', async () => {
    const { fixture } = await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('有通知时应渲染通知内容', async () => {
    const { fixture, service } = await setup();
    service.error('网络错误');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('网络错误');
  });

  it('应渲染 summarry 和 detail', async () => {
    const { fixture, service } = await setup();
    service.error('错误', '详细信息');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('错误');
    expect(el.textContent).toContain('详细信息');
  });

  it('无 detail 时应不显示详情行', async () => {
    const { fixture, service } = await setup();
    service.warn('警告');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // 只显示总结，不显示额外的 detail 行
    const detailEl = el.querySelector('.block.text-xs');
    expect(detailEl).toBeNull();
  });

  it('点击通知区域应调用 dismiss', async () => {
    const { fixture, component, service } = await setup();
    const dismissSpy = vi.spyOn(service, 'dismiss');

    service.error('网络错误');
    fixture.detectChanges();

    const alertEl = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alertEl).toBeTruthy();
    alertEl.click();

    expect(dismissSpy).toHaveBeenCalled();
  });

  it('bgClass 应为不同严重级别返回正确样式', () => {
    const component = TestBed.createComponent(ErrorToastComponent).componentInstance;
    expect(component.bgClass('error')).toContain('bg-red-600');
    expect(component.bgClass('warn')).toContain('bg-amber-500');
    expect(component.bgClass('success')).toContain('bg-indigo-600');
    expect(component.bgClass('info')).toContain('bg-blue-600');
  });
});
