# 前端 Signal Forms 示例

---

## 1. 标准 Signal Forms 组件（Dialog CRUD）

```typescript
import { form, FormField, FormRoot, required } from '@angular/forms/signals';

@Component({
  selector: 'app-crud-dialog',
  imports: [Button, Dialog, FormField, FormRoot, InputText],
  template: `
    <p-button label="创建" (onClick)="onCreate()" />
    <p-dialog [(visible)]="visible" [header]="isEditing() ? '编辑' : '创建'" modal (onHide)="onHide()">
      <form [formRoot]="form" (submit)="submitted.set(true)">
        <input pInputText [formField]="form.name" [pInvalid]="submitted() && form.name().invalid()" />
        @if (submitted() && form.name().invalid()) {
          <app-error-messages [errors]="form.name().errors()" />
        }
        <p-button type="submit" label="保存" />
      </form>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CrudDialogComponent {
  private readonly messageService = inject(MessageService);

  readonly visible = signal(false);
  readonly isEditing = signal(false);
  readonly submitted = signal(false);

  readonly form = form(
    signal({ name: '' }),
    (path) => {
      required(path.name, { message: '名称不能为空' });
    },
    {
      submission: {
        action: async () => {
          await lastValueFrom(this.service.create(this.form().value()));
          this.messageService.add({ severity: 'success', summary: '创建成功' });
          this.visible.set(false);
        },
      },
    },
  );

  onCreate() {
    this.isEditing.set(false);
    this.form().reset({ name: '' });
    this.visible.set(true);
  }

  onEdit(item: Item) {
    this.isEditing.set(true);
    this.form().reset({ name: item.name });
    this.visible.set(true);
  }

  onHide() {
    this.submitted.set(false);
    this.visible.set(false);
  }
}
```

---

## 2. 复合表单模型（条件隐藏/禁用）

```typescript
interface FormModel {
  type: 'mysql' | 'postgres' | 'http';
  name: string;
  db: { host: string; port: number | null };
  http: { baseUrl: string };
}

readonly mode = signal<'create' | 'edit'>('create');

readonly form = form(signal(domainModelToFormModel(null)), (path) => {
  required(path.name, { message: '名称不能为空' });
  disabled(path.type, () => this.mode() === 'edit');
  hidden(path.db, ({ valueOf }) => valueOf(path.type) === 'http');
  hidden(path.http, ({ valueOf }) => valueOf(path.type) !== 'http');
  required(path.http.baseUrl, { message: '基础 URL 不能为空' });
});
```

---

## 3. Signal Forms 异步提交（带 loading）

```typescript
readonly form = form(signal(EMPTY_USER), (path) => {
  required(path.username, { message: '用户名不能为空' });
}, {
  submission: {
    action: async () => {
      this.loading.set(true);
      try {
        const user = await lastValueFrom(
          this.authService.createUser(this.form().value())
        );
        this.messageService.add({ severity: 'success', summary: '创建成功' });
        this.visible.set(false);
        this.users.update(users => [...users, user]);
      } finally {
        this.loading.set(false);
      }
    },
  },
});
```
