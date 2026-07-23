import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotFoundComponent } from './not-found.component';

describe('NotFoundComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotFoundComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component };
  }

  it('应创建组件', async () => {
    const { component } = await setup();
    expect(component).toBeTruthy();
  });

  it('应显示 404 标题', async () => {
    const { fixture } = await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('404');
    expect(el.textContent).toContain('页面未找到');
    expect(el.textContent).toContain('您访问的页面不存在或已被移除');
  });

  it('goHome 应导航到 /projects', async () => {
    const { component, fixture } = await setup();
    const routerSpy = vi.spyOn((component as any).router, 'navigateByUrl');

    component.goHome();
    expect(routerSpy).toHaveBeenCalledWith('/projects');
  });

  it('应渲染返回首页按钮', async () => {
    const { fixture } = await setup();
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector('p-button') || el.querySelector('[data-testid="not-found-home"]');
    expect(button).toBeTruthy();
  });
});
