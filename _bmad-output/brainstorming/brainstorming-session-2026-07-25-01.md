# Brainstorming Session — Oceanus 工程化升级

- **日期**：2026-07-25
- **参与方式**：Claude Code + 用户讨论
- **关联 Change**：`engineering-infra-upgrade`

---

## 讨论主题

对 Oceanus 项目（Angular 21 + NestJS 11 monorepo）进行工程化全面升级，从原型阶段提升到可协作、可部署的成熟工程水平。

## 关键决策

1. **分轮实施**：本轮（P0+P1）做 CI/CD、Dockerfile、Git Hooks、客户端测试、GlitchTip；P2+P3 开后续 change
2. **错误追踪选型**：GlitchTip（MIT 开源，Sentry SDK 兼容，2GB 内存），弃用 Sentry self-hosted（14GB 太重）
3. **CI 触发策略**：PR + push main 均跑完整 lint → typecheck → test → build
4. **Server Docker**：生产模式 multi-stage build（build → dist）
5. **Client 测试**：user-menu 组件 + 1 个核心业务页面作为示例
6. **开启 GitHub Branch Protection**：要求 CI 通过才能合并

## 范围（本轮 P0+P1）

### P0 — 自动化基础

| 方向                | 内容                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **CI/CD Pipeline**  | GitHub Actions workflow：lint → typecheck → test(server+client) → build(server+client)，PR + main 双触发             |
| **应用 Dockerfile** | Server: multi-stage build (prisma generate → nest build → dist)；Client: Angular build → Nginx serve + 反向代理 /api |

### P1 — 质量保障

| 方向           | 内容                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| **Git Hooks**  | Husky + lint-staged + commitlint (Conventional Commits)，与现有 Claude Code hooks 并存 |
| **客户端测试** | 基于已有 Vitest + TestBed 架子，为 user-menu + 1个核心页面写测试                       |
| **GlitchTip**  | 集成到 docker-compose，复用现有 PG + Redis，NestJS/Angular 只改 DSN                    |

## 边界（明确不做）

1. ❌ 不做生产环境部署（k8s/云服务），Docker Compose 是交付标准
2. ❌ 不做 Grafana/Prometheus 等重量级可观测性
3. ❌ 不做 tRPC/GraphQL API 范式切换
4. ❌ 不做 CD（自动部署），CI 止于 build 产物
5. ❌ 不做测试覆盖率硬性门禁，先建基础设施和模式
6. ❌ 不做 Sentry self-hosted（资源过重），选用 GlitchTip 替代
7. ❌ 不做 Nx/Turborepo（本轮），留到 P2
8. ❌ 不做 E2E 测试（本轮），留到 P2

## 后续步骤

1. 进入 openspec SDD 文档生成（proposal → specs → design → tasks）
2. 通过 spec-hardener 和 writing-plans
3. superpowers 门禁检查
4. TDD/Plan Mode 实现
