# 前端实体/类型示例

## 1. 实体接口层次

实体接口镜像后端实体层次，定义在 `shared/base.ts`：

```typescript
export interface ImmutableEntity {
  id: number;
  createdAt: LocalDateTime;
}
export interface Entity extends ImmutableEntity {
  lastModifiedAt: LocalDateTime;
}
export interface ImmutableAuditable<T> extends ImmutableEntity {
  createdBy: T;
}
export interface Auditable<T> extends Entity {
  createdBy: T;
  lastModifiedBy: T;
}

// UserSummary（审计字段常用类型）
export interface UserSummary {
  id: number;
  username: string;
  fullName: string;
}
```

> `LocalDateTime` 来自 `@js-joda/core`，配合 `iso8601Interceptor` 自动从 JSON 反序列化。

## 2. 实体定义示例

```typescript
// 可变实体（extends Entity）
export interface FormSummary extends Entity {
  title: string;
  approvalEnabled: boolean;
  printConfig: PrintConfig | null;
  actions: FormAction[];
}

// 可审计可变实体（extends Auditable<UserSummary>）
export interface FormResponse extends Auditable<UserSummary> {
  answers: Partial<Record<string, Answer>>;
  approvalState: ApprovalState | null;
  status: 'NOT_STARTED' | 'RUNNING' | 'DONE' | 'FAILED';
  formRevisionId: number;
}
```

## 3. 分页响应

```typescript
export interface PageRequest {
  page: number;
  size: number;
  sort: string;
}
export interface PagedResponse<T extends ImmutableEntity> {
  items: T[];
  totalItems: number;
}

// 将 PrimeNG p-table (lazy) 的 TableLazyLoadEvent 转换为后端分页参数
export function toPageRequest(event: TableLazyLoadEvent): PageRequest {
  const { first, rows, sortField, sortOrder } = event;
  return {
    page: first! / rows!,
    size: rows!,
    sort: `${Array.isArray(sortField) ? sortField.join(',') : sortField},${sortOrder === -1 ? 'desc' : 'asc'}`,
  };
}

// Service 中使用
@Injectable({ providedIn: 'root' })
export class DataObjectInstanceService {
  private readonly http = inject(HttpClient);

  list(objectId: signal<number | undefined>) {
    return httpResource<PagedResponse<DataObjectInstance>>(() => {
      const id = objectId();
      return id !== undefined ? `/api/v1/apps/${this.appService.appId()}/objects/${id}/instances` : undefined;
    });
  }
}
```

## 4. Discriminated Union 模式

```typescript
// 用户类型（字符串字面量 discrimination）
interface BaseUser extends Entity {
  type: string;
  username: string;
  fullName: string;
  role: Role;
  disabled: boolean;
}
export interface InternalUser extends BaseUser {
  type: 'InternalUser';
}
export interface CdyxUser extends BaseUser {
  type: 'CdyxUser';
}
export type User = InternalUser | CdyxUser;

// 字段值类型（按 type 字段分发）
export type FieldValue = TextValue | NumberValue | BooleanValue;
export interface TextValue {
  type: 'text';
  value: string | null;
}
export interface NumberValue {
  type: 'number';
  value: number | null;
}
```

## 5. 关键规则

| 规则                      | 说明                                             |
| ------------------------- | ------------------------------------------------ |
| **interface，不是 class** | 实体全是 `interface`，没有 `class`               |
| **类型参数 `T`**          | 审计字段的 `T` 通常是 `UserSummary`              |
| **必要字段**              | 字段不设可选（`?`），后端保证返回                |
| **枚举用 union**          | 状态字段用 literal union，不用 TypeScript `enum` |
| **字段注释**              | Entity/接口字段加 `/** */` 注释；简单的 DTO 不加 |
| **参数顺序**              | `appId` → 父级 ID → 自身 ID → name/描述          |
