/**
 * localStorage polyfill for Angular + jsdom + Zone.js.
 *
 * Zone.js 对 window 的代理可能导致 localStorage 原型链方法
 * （clear、getItem、setItem 等）丢失。
 *
 * 此文件通过 angular.json 的 setupFiles 配置注入，
 * 在 polyfills (zone.js) 和 Angular TestBed 初始化之后、
 * 测试文件之前执行。
 */

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(String(key), String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

// 覆盖 globalThis 和 window 上的 localStorage，绕过 Zone.js 的代理
const mock = createStorageMock();
try {
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
} catch {
  // Fallback: direct assignment
}
try {
  Object.defineProperty(window, 'localStorage', { value: mock, configurable: true, writable: true });
} catch {
  // window 可能不可用
}
