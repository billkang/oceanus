# 前端编码快速参考

按需加载。仅当你需要编写对应组件类型时阅读相关章节。

> **完整示例代码见 `examples/` 目录。** 已安装子维度的规范，通过该维度的 `{value}.md` 文件阅读。

## 速查

| 场景         | 决策                                               |
| ------------ | -------------------------------------------------- |
| 新建组件     | Standalone + OnPush + inline template + inject()   |
| 新建表单     | Signal Forms（`form()`），非 Reactive Forms        |
| 读数据       | `httpResource()`                                   |
| 写数据       | `HttpClient` + `finalize(() => resource.reload())` |
| Service 职责 | 只负责网络请求，不管理 UI 状态                     |
| 路由         | `loadComponent` 懒加载                             |

## 新建组件

```typescript
@Component({
  selector: 'app-example',
  imports: [/* 显式导入 */],
  template: `...`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 p-4' },
})
export class ExampleComponent {
  private readonly router = inject(Router);
  submitted = output<number>();
}
```

| 规则       | 要求                                                |
| ---------- | --------------------------------------------------- |
| Standalone | 禁止 NgModule，`imports: []` 显式导入               |
| `OnPush`   | 模板中所有输入 immutable                            |
| `inject()` | 禁止构造函数注入                                    |
| `output()` | 禁止 `@Output()` + `EventEmitter`                   |
| `host`     | 容器样式用 `host: { class: '...' }`，不包裹 `<div>` |

## Signal 状态

响应式状态用 `signal()` / `computed()` / `linkedSignal()`；私有 signal 对外暴露用 `asReadonly()`；模板中必须调用 signal（写 `signal()`，不要写 `signal`）。

### Signal Forms（新表单首选）

使用 `@angular/forms/signals` 的 `form()`，不再新增 `FormGroup`/`FormBuilder`：

```typescript
readonly form = form(signal({ name: '', email: '' }), (path) => {
  required(path.name);
  email(path.email);
}, {
  submission: { action: async () => {
    await lastValueFrom(this.service.create(this.form().value()));
  }},
});
```

## HTTP / Service

- **读请求**：`httpResource()` — URL 函数返回 `undefined` 时跳过请求
- **写请求**：`HttpClient` + `finalize(() => resource.reload())`
- **Service 职责**：只做网络请求，不管理 UI 状态
- **Blob 下载错误处理**：`responseType: 'blob'` 时后端 JSON 错误被包装为 Blob，需在 error handler 中解析
- **API 路径**：基础前缀 `/api/v1/`；自定义方法用 AIP-136 冒号语法

## 错误处理

- `errorHandlingInterceptor` 已全局注册，统一显示 toast；组件层不额外 `catchError`
- `iso8601Interceptor`：自动将 ISO 8601 字符串转换为 `@js-joda/core` 类型
- 401 由 auth guard 处理，拦截器跳过
- 表单验证错误用 `<app-error-messages>` 组件渲染

## 路由

- 所有功能组件用 `loadComponent` 懒加载
- 权限通过路由 `data.requiredAuthority` / `data.requireRootTenant` 控制
- `authGuard` 在每个受保护路由独立注册，不在根路由全局注册

## 代码风格

- 控制流语句必须使用大括号，禁止无大括号的早期返回
- 代码折行规则（90 列限制）详见 `examples/code-wrapping.md`

## 注释规则

| 文件类型      | 注释要求                                 |
| ------------- | ---------------------------------------- |
| **类型定义**  | 复杂类型加行内注释说明字段含义           |
| **Service**   | 简要说明每个方法的功能和返回类型         |
| **Component** | 关键组件加注释说明用途；复杂逻辑行内注释 |

## 前端实体类型

实体接口镜像后端实体层次，定义在 `shared/base.ts`：`ImmutableEntity` → `Entity` → `Auditable<T>` / `ImmutableAuditable<T>`。完整定义、分页响应、Discriminated Union 模式见 `examples/entity-types.md`。

## 常见坑

| 场景                    | 问题                                           | 正确做法                                                 |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Blob 下载               | 后端返回 JSON 时 err.error 被包装为 Blob       | `err.error.text().then(text => JSON.parse(text))`        |
| httpResource 初始化     | URL 返回 undefined 时 res.value() 为 undefined | `computed(() => res.value()?.items ?? [])`               |
| `form().reset()`        | 只传部分字段，缺失字段不被重置                 | `form().reset({ name: '' })` 补全所有字段                |
| Service 状态泄漏        | 在 Service 中放 signal 管理 UI 状态            | Service 只做网络请求，状态放在 Component 中              |
| `model()` vs `output()` | 需双向绑定时用了 output()                      | 用 `model()`，父组件 `[(visible)]="xxx"`                 |
| submit handler          | 未阻止默认提交行为                             | 用 `FormRoot` 指令，或 `(submit)="check()"` + 检查 valid |
