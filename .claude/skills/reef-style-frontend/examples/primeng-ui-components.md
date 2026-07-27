# 前端 UI 组件示例

---

## 1. PrimeNG 使用原则

### Boolean shorthand

PrimeNG 的 boolean 属性传 `true` 时直接用属性名，不用 `[prop]="true"`：

```html
<!-- ✓ 正确 -->
<p-dialog [(visible)]="visible" modal (onHide)="onHide()">
  <p-button severity="secondary" outlined loading disabled />

  <!-- ✗ 错误 -->
  <p-dialog [(visible)]="visible" [modal]="true"></p-dialog
></p-dialog>
```

### CSS Layer 顺序

`styles.css` 中 CSS Layer 顺序：

```css
@layer theme, base, antd, primeui, primeicons, components, utilities;
```

### providePrimeNG 全局配置

```typescript
bootstrapApplication(App, {
  providers: [
    providePrimeNG({
      overlayAppendTo: 'body',
      zIndex: { modal: 1100, overlay: 1000, menu: 1000, tooltip: 1100 },
      locale: zhHans(),
      cssLayer: { name: 'primeui', order: 'theme, base, antd, primeui, primeicons, components, utilities' },
      theme: { preset: Aura, options: { darkModeSelector: '.dark' } },
    }),
  ],
});
```

---

## 2. PrimeNG Table 懒加载

```typescript
@Component({
  selector: 'app-user-list',
  imports: [TableModule],
  templateUrl: './user-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListComponent {
  private readonly authService = inject(AuthService);

  readonly users = signal<User[]>([]);
  readonly totalUsers = signal(0);

  loadUsers(event: TableLazyLoadEvent) {
    this.authService.listUsers(toPageRequest(event)).subscribe(({ items, totalItems }) => {
      this.users.set(items);
      this.totalUsers.set(totalItems);
    });
  }
}
```

---

## 3. 确认弹窗（删除操作）

```typescript
@Component({
  imports: [ConfirmDialog],
  providers: [ConfirmationService],
  template: `
    <p-confirmdialog />
    <p-button label="删除" (onClick)="onDelete(item.id)" />
  `,
})
export class MyComponent {
  private readonly confirmationService = inject(ConfirmationService);

  onDelete(id: number) {
    this.confirmationService.confirm({
      accept: () =>
        this.itemService
          .delete(id)
          .subscribe(() => this.messageService.add({ severity: 'success', summary: '删除成功' })),
    });
  }
}
```

---

## 4. Drawer 侧边栏

```typescript
@Component({
  template: `
    <p-drawer styleClass="w-200" [(visible)]="visible" position="right" (onHide)="onHide()">
      <ng-template #header>
        <div class="font-bold text-2xl">标题</div>
      </ng-template>
      <ng-template #footer>
        <div class="flex justify-end items-center gap-2">
          <p-button severity="secondary" outlined label="取消" (onClick)="onHide()" />
          <p-button type="submit" label="确定" />
        </div>
      </ng-template>
    </p-drawer>
  `,
})
export class DrawerComponent {
  readonly visible = signal(false);

  onHide() {
    this.visible.set(false);
  }
}
```
