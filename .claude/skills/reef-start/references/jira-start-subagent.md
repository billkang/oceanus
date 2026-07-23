# 子代理实现详情（已废弃 — 迁移至 TDD 实现）

> **⚠️ 本文件已被 `SKILL.md.tmpl` 中的 TDD（Red → Green → Refactor）实现流程替代。**
>
> 原阶段五（现阶段四）的子代理 A→E 编码循环已移除，替换为：
> - 逐 task TDD 循环（RED → GREEN → REFACTOR）
> - 纯配置/文档/SKILL.md 豁免 TDD
> - 详见 SKILL.md.tmpl 的「阶段四：TDD 实现」
>
> **本文件保留仅用于参考兼容性，实际实现时请遵循主 SKILL.md 的 TDD 流程。**

---


## 步骤 A：构造子代理 prompt

组合以下上下文发送给子代理：

- **任务组** + **子任务清单**（来自 tasks.md 当前 section）
- **Spec 要求**（匹配的 specs/ 场景文件）
- **设计上下文**（design.md 的 Change Scope Matrix + API 契约 + 相关决策）
- **设计工具数据**（如有，优先使用 MCP 返回的原始数据而非猜测）
- **实现方法论**：
  1. 加载 code-gen skill
  2. 找参考实现 → 读编码规范
  3. 按序编码（后端：Entity→DTO→Mapper→Repository→Service→Controller）
  4. 运行验证命令
  5. 报告 DONE / DONE_WITH_CONCERNS
- **项目红线**：后端 `findByIdAndAppId` + 多租户实体；前端 Standalone + OnPush + inject() + Signal Forms + httpResource；中文注释保留英文专有名词

## 步骤 B：派遣子代理

使用 `Agent` 工具（type: `"general-purpose"`），prompt 为步骤 A 构造的内容。

| 返回状态 | 处理 |
|---------|------|
| **DONE** | 继续步骤 C |
| **DONE_WITH_CONCERNS** | 阅读疑虑。涉及正确性则先修复；仅观察则记录后继续 |
| **NEEDS_CONTEXT** | 补充上下文后重新派遣 |
| **BLOCKED** | context 不足→补充；task 过大→拆分；plan 错误→告知用户 |

## 步骤 C：Spec 合规审查

1. 读取关联 spec 文件，逐条检查每个 WHEN/THEN 在代码中是否被覆盖
2. 全部覆盖 → ✅ 通过，进入步骤 D
3. 有缺失 → 记录缺失项，派遣 fix 子代理补充，重新审查
4. 过度实现 → 记录，留到 code-audit 决定
5. **冲突检查：** 若本节改动了之前 section 改过的文件，验证行范围是否重叠。不一致则标记为冲突并修复合并后再继续

## 步骤 D：更新 tasks.md

将该 section 下所有 `- [ ]` 子任务统一改为 `- [x]`。运行 `openspec status --change "$CHANGE"` 确认进度。

## 步骤 E：继续下一 section

处理下一个还有 `- [ ]` 的 section。全部完成后进入 5.3（code-audit）。

## 子代理隔离原则

每个 section 派遣独立子代理，不继承主 session 历史。prompt 中携带全部上下文，避免跨 section 上下文污染。
