# Angular 前端编码步骤

按以下顺序逐块编写，依赖关系由前向后：

1. **类型定义** — 实体接口/类型，继承 `shared/base.ts`
2. **Service** — HttpClient 封装，`httpResource` 读请求
3. **Component** — 组件 UI，Signal 状态，Signal Forms
4. **路由** — `loadComponent` 懒加载注册

每完成一块对照 `reef:reef-style-frontend` 中对应章节检查。

## 注释要求

| 文件类型      | 注释要求                                 |
| ------------- | ---------------------------------------- |
| **类型定义**  | 复杂类型加行内注释说明字段含义           |
| **Service**   | 简要说明每个方法的功能和返回类型         |
| **Component** | 关键组件加注释说明用途；复杂逻辑行内注释 |
| **路由**      | 无需额外注释                             |

## 核心约束

- Standalone 组件（不使用 NgModule）
- OnPush ChangeDetection
- `inject()` 代替构造函数注入
- Signal Forms 代替模板驱动表单
- `httpResource` 代替手动 subscribe
- Service 禁止管理 UI 状态

## 构建命令

```bash
# 快速验证
pnpm lint
pnpm typecheck

# 完整检查
pnpm lint && pnpm typecheck && pnpm test
```
