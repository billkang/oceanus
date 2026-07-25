import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { UserMenuComponent } from './user-menu.component';

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  const mockUser = {
    id: 1,
    username: 'testuser',
    displayName: 'Test User',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserMenuComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', mockUser);
    fixture.detectChanges();
  });

  it('应创建组件', () => {
    expect(component).toBeTruthy();
  });

  it('应显示用户首字母头像', () => {
    expect(component.userInitial()).toBe('T');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('T');
  });

  it('应显示用户 displayName', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Test User');
  });

  it('没有 displayName 时应回退显示 username', () => {
    fixture.componentRef.setInput('user', {
      id: 2,
      username: 'nouser',
      displayName: '',
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('nouser');
  });

  it('点击退出登录应触发 logout 事件', () => {
    // 先打开菜单
    component.toggle();
    fixture.detectChanges();

    const logoutSpy = vi.fn();
    component.logout.subscribe(logoutSpy);

    // 找到退出登录按钮并点击
    const logoutBtn = fixture.nativeElement.querySelector('button:last-child') as HTMLButtonElement;
    logoutBtn?.click();
    fixture.detectChanges();

    expect(logoutSpy).toHaveBeenCalled();
  });

  it('toggle 应切换下拉菜单开关状态', () => {
    expect(component.open()).toBe(false);
    component.toggle();
    expect(component.open()).toBe(true);
    component.toggle();
    expect(component.open()).toBe(false);
  });

  it('按 Escape 键应关闭下拉菜单', () => {
    component.toggle();
    expect(component.open()).toBe(true);

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);
    fixture.detectChanges();

    expect(component.open()).toBe(false);
  });
});
