import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
    service.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    service.clear();
  });

  it('error 应添加错误通知，autoClose=8000ms', () => {
    service.error('错误标题', '错误详情');
    const notifications = service.notifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].severity).toBe('error');
    expect(notifications[0].summary).toBe('错误标题');
    expect(notifications[0].detail).toBe('错误详情');
    expect(notifications[0].autoCloseMs).toBe(8000);
  });

  it('warn 应添加警告通知，autoClose=6000ms', () => {
    service.warn('警告标题');
    const notifications = service.notifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].severity).toBe('warn');
    expect(notifications[0].autoCloseMs).toBe(6000);
  });

  it('info 应添加信息通知，autoClose=4000ms', () => {
    service.info('信息标题');
    const notifications = service.notifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].severity).toBe('info');
    expect(notifications[0].autoCloseMs).toBe(4000);
  });

  it('success 应添加成功通知，autoClose=4000ms', () => {
    service.success('成功标题');
    const notifications = service.notifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].severity).toBe('success');
    expect(notifications[0].autoCloseMs).toBe(4000);
  });

  it('notifications 应累积多条通知', () => {
    service.error('错误');
    service.warn('警告');
    service.info('信息');
    expect(service.notifications().length).toBe(3);
  });

  it('dismiss 应移除指定通知', () => {
    service.error('错误');
    const id = service.notifications()[0].id;
    service.dismiss(id);
    expect(service.notifications().length).toBe(0);
  });

  it('dismiss 不影响其他通知', () => {
    service.error('错误1');
    const id1 = service.notifications()[0].id;
    service.error('错误2');
    service.dismiss(id1);
    expect(service.notifications().length).toBe(1);
    expect(service.notifications()[0].summary).toBe('错误2');
  });

  it('clear 应移除所有通知', () => {
    service.error('错误1');
    service.warn('警告');
    service.info('信息');
    service.clear();
    expect(service.notifications().length).toBe(0);
  });

  it('autoClose 超时后应自动移除通知', () => {
    service.error('错误');
    expect(service.notifications().length).toBe(1);

    vi.advanceTimersByTime(8000);
    expect(service.notifications().length).toBe(0);
  });

  it('autoClose 不同严重级别应有不同超时时间', () => {
    service.info('信息');
    service.warn('警告');

    // 4000ms 后 info 应消失，warn 仍在
    vi.advanceTimersByTime(4000);
    expect(service.notifications().length).toBe(1);
    expect(service.notifications()[0].severity).toBe('warn');

    // 再过 2000ms 后 warn 消失
    vi.advanceTimersByTime(2000);
    expect(service.notifications().length).toBe(0);
  });
});
