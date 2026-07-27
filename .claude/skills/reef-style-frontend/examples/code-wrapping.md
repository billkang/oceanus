# 前端代码折行示例（90 列限制）

## 函数/方法签名

参数 ≤ 2 个且行总长 ≤ 90 则一行。超过时每行一个参数，2 格缩进：

```typescript
private saveAllSuccessful(
  appId: number,
  form: Form,
  answers: Map<number, Map<string, Answer>>,
): void { ... }
```

## RxJS Pipe 链

每个算子一行，行首 `.`，2 格缩进：

```typescript
this.service
  .getData(id)
  .pipe(
    switchMap((data) => this.otherService.process(data)),
    takeUntilDestroyed(this.destroyRef),
    finalize(() => this.loading.set(false)),
  )
  .subscribe((result) => this.data.set(result));
```

## Signal / computed / httpResource

简单用 `()` 直接返回，复杂用 `{}` 块。超过 90 列时换行：

```typescript
readonly name = computed(() => this.user().username);

readonly columns = computed(() => {
  if (this.visibleColumns().length === 0) { return [...]; }
  return this.visibleColumns().map(mapColumn);
});

private readonly formRevision = httpResource<FormRevision>(() => {
  const id = this.response()?.formRevisionId;
  return this.appId() !== null && id !== undefined
    ? `/api/v1/apps/${this.appId()}/forms/${this.formId()}/revisions/${id}`
    : undefined;
});
```

## Signal Forms 校验链

每个 validator 一行，2 格缩进：

```typescript
readonly form = form(signal(EMPTY_ITEM), (path) => {
  required(path.name, { message: '名称不能为空' });
  disabled(path.code, () => this.mode() === 'edit');
  hidden(path.db, ({ valueOf }) => valueOf(path.type) === 'http');
  validate(path.url, ({ value }) => {
    return URL.parse(value()) === null
      ? { kind: 'url', message: 'URL 格式不正确' }
      : null;
  });
}, {
  submission: { action: async () => {
    await lastValueFrom(this.service.create(this.form().value()));
  }},
});
```

## 条件/三元表达式

```typescript
if (
  answer?.type === 'DateTimeAnswer'
  && answer.value !== null
) { ... }

const redirect = this.appId() !== null && this.formId() !== null
  ? `/api/v1/apps/${this.appId()}/forms/${this.formId()}/responses`
  : undefined;
```

## 模板 HTML 属性

整个标签（含所有属性）≤ 90 列则保持一行，超过 90 列才每行一个属性：

```angular2html
<!-- ≤ 90 列，一行 -->
<p-button type="submit" label="提交" (onClick)="form.submit()" />

<!-- > 90 列，每行一个属性 -->
<p-dialog
  [(visible)]="visible"
  [header]="isEditing ? '编辑' : '新增'"
  modal
  (onHide)="handleHide()"
>

<!-- 含复杂表达式属性，超长拆行 -->
<p-button
  type="submit"
  label="提交"
  [disabled]="!form.form().valid"
  (onClick)="form.submit()"
/>

<!-- 内容独占一行 -->
<span class="text-red-600 font-medium">
  {{ error() }}
</span>
```

HTML 注释和纯文字内容不折行，即使超过 90 列也保持一行。

## 长 class 三层规则（逐级尝试，选第一个满足 ≤ 90 列的）

```angular2html
<!-- 第 1 层：class="..." 一行能放下则一行 -->
<div class="flex flex-col items-center gap-2 p-5 bg-blue-50">

<!-- 第 2 层：一行放不下时，class=" 单独一行，所有 class 排在缩进行 -->
<div
  class="
    flex flex-col md:flex-row md:justify-between md:items-start md:w-4xl w-full gap-8
  "
>

<!-- 第 3 层：仍超过 90 列时按功能分组排版 -->
<div
  class="
    flex flex-col items-center justify-between gap-3 p-4
    bg-white border border-gray-200 rounded-lg shadow-sm
    hover:shadow-md transition-shadow cursor-pointer
  "
>
```

## `@if` / `@for` / `@let` 结构指令

```angular2html
@if (data(); as items) {
  <div class="text-gray-500">加载完成</div>
} @else {
  <div class="text-gray-500">加载中...</div>
}

<div class="flex flex-col gap-2">
  @for (item of items(); track item.id) {
    <div class="border p-2">{{ item.name }}</div>
  } @empty {
    <div class="text-gray-400">暂无数据</div>
  }
</div>
```

## `inject()` 声明

每个 `inject()` 独立一行。同类依赖相邻，不同类之间空行：

```typescript
private readonly messageService = inject(MessageService);
private readonly confirmationService = inject(ConfirmationService);

private readonly formBuilder = inject(NonNullableFormBuilder);

private readonly authService = inject(AuthService);
private readonly dataSourceService = inject(DataSourceService);
```

## 数组/对象字面量

`imports` 数组总是每项一行（项目约定），按字母序排列。其他数组/对象 ≤ 90 列一行，超过再拆行：

```typescript
imports: [
  Button, ConfirmDialog, Dialog, ErrorMessages,
  FormField, FormRoot, InputText, TableModule,
],

private readonly columns = ['name', 'age', 'email'];

const longOption = {
  label: '这是一个很长的文本标签',
  value: 'long-value-key',
};
```

## 泛型/类型标注

长泛型约束提取 type 别名：

```typescript
type DialogState = 'a' | 'b' | 'c' | 'd' | 'e';
readonly state = computed<DialogState>(() => { ... });
```

## `subscribe()` 回调

```typescript
this.service.list(toPageRequest(event)).subscribe(({ items, totalItems }) => {
  this.users.set(items);
  this.totalUsers.set(totalItems);
});

this.service.delete(id).subscribe(() => {
  this.messageService.add({ severity: 'success', summary: '删除成功' });
});
```

## `.find()` / `.filter()` 回调

≤ 90 列则一行，超过时回调换行（2 格缩进），回调以 `,` 结尾，`)!` 单独一行：

```typescript
const page = this.pages().find((p) => p.id === id)!;

const selectedForm = this.formService.forms().find((form) => form.id === menuItem.formId!)!;
```

## `messageService.add()` 等对象参数

对象参数 ≤ 90 列一行，超过拆行：

```typescript
this.messageService.add({ severity: 'success', summary: '提交成功' });

this.messageService.add({
  severity: 'warn',
  summary: '当前应用已被禁用，暂无法进行业务操作',
});
```

## 路由 `loadComponent`

```typescript
loadComponent: () => import('./admin/user-list/user-list.component')
  .then(m => m.UserListComponent),

loadComponent: () =>
  import('./page-not-found/page-not-found.component').then(m => m.PageNotFoundComponent),
```

## `async/await`

await 右侧超过 90 列时换行（2 格缩进）：

```typescript
const user = await lastValueFrom(this.authService.createUser(this.form().value()));
```
