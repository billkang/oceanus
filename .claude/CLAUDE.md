# Oceanus

## 技术栈

- **前端**：angular
- **UI 库**：primeng
- **CSS 方案**：tailwind
- **后端**：Node.js (NestJS)
- **ORM**：prisma
- **AI 框架**：claude-agent-sdk

> 项目上下文见 `.deepstorm/context.md`

---

## 文档同步规则

修改代码时同步检查并更新对应文档：

| 变更内容                | 需要同步的文档                             |
| ----------------------- | ------------------------------------------ |
| 新增/修改后端模块       | `docs/2-architecture/overview.md`          |
| 新增/修改 Prisma schema | `docs/2-architecture/data-model.md`        |
| 新增技术决策            | `docs/2-architecture/decisions/ADR-NNN.md` |
| 修改 API 端点           | `docs/3-api/api-reference.md`              |
| 修改前端组件/路由       | `docs/4-ui/`                               |
| 修改 Docker/CI/CD 配置  | `docs/5-operations/`                       |
| 修改包依赖/构建配置     | `docs/1-getting-started/`                  |

> 手动运行 `/docs-sync` 可进行全面检查（需安装 deepstorm-docs-sync skill）。

## 文档图约定

所有架构图、流程图、关系图必须使用 Mermaid 语法（````mermaid`），禁止使用纯文本字符画图。

## 文档入口

项目所有文档的入口为 `docs/INDEX.md`，按角色分类。
