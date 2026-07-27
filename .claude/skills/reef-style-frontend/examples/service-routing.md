# 前端 Service 层与路由示例

## 1. httpResource 服务层封装

```typescript
@Injectable({ providedIn: 'root' })
export class ItemService {
  private readonly http = inject(HttpClient);

  private readonly itemsResource = httpResource<ListResponse>(() => '/api/v1/items');

  // 只读暴露给组件
  readonly items = computed<Item[]>(() => this.itemsResource.value()?.items ?? []);
  readonly loading = this.itemsResource.isLoading;

  /** 写操作：HttpClient + finalize reload */
  create(request: { name: string }) {
    return this.http.post<Item>('/api/v1/items', request).pipe(finalize(() => this.itemsResource.reload()));
  }

  delete(id: number) {
    return this.http.delete(`/api/v1/items/${id}`).pipe(finalize(() => this.itemsResource.reload()));
  }
}
```

## 2. 模板控制流

```angular2html
@for (item of items(); track item.id) {
  @switch (item.type) {
    @case ('TextControl') {
      @let label = item.label || '未命名';
      <app-text-control [label]="label" />
    }
    @case ('ChoiceControl') {
      <app-select [options]="item.options" />
    }
    @default {
      <div>未知控件: {{ item.type }}</div>
    }
  }
}
```

## 3. 路由配置模式

```typescript
export const routes: Routes = [
  {
    path: '',
    component: DefaultLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        title: '仪表盘',
        loadComponent: () => import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
    ],
  },
  {
    path: 'admin',
    component: DefaultLayoutComponent,
    canActivate: [authGuard],
    data: { requiredAuthority: 'ADMIN' },
    children: [
      {
        path: 'users',
        title: '用户管理',
        loadComponent: () => import('./admin/user-list/user-list.component').then((m) => m.UserListComponent),
      },
      {
        path: 'role-mappings',
        canActivate: [authGuard],
        data: { requiredAuthority: 'ADMIN', requireRootTenant: true },
        loadComponent: () =>
          import('./admin/role-mappings/role-mappings.component').then((m) => m.RoleMappingsComponent),
      },
    ],
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
    canActivate: [authGuard],
  },
  {
    path: '**',
    loadComponent: () => import('./page-not-found/page-not-found.component').then((m) => m.PageNotFoundComponent),
  },
];
```
