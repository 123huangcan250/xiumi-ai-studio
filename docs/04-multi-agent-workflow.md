# 多 Agent 协作流程

主脑（Claude Code / Codex 强模型）负责架构、接口契约与最终审查；低成本 Worker（DeepSeek、MiMo、MiniMax 等）在独立 Git Worktree 中实现边界清晰的任务。

> 本 MVP 由主脑单独完成，尚未接入外部 Worker；以下是接入时的约定。

## 适合交给 Worker 的任务

模块边界都是纯函数或单文件组件，契约写在 `src/core/types.ts`：

| 任务 | 契约 | 验收 |
|---|---|---|
| 新增模块类型（如“二维码卡片”“问答”） | `BlockPropsMap` 增加字段 → `blocks.ts` 默认值 → `compiler.ts` 渲染器 → `PropsForm.tsx` 表单 | 单元测试“每个模块 × 每个主题”通过；`lintWechatHtml` 无警告 |
| 新增主题 | `Theme` 对象加入 `THEMES` | 单元测试全部主题编译通过，草稿箱长度 < 20,000 |
| 新增版式配方 | `LayoutRecipe.build(outline, pool)` | 使用全部图片、首尾为封面/署名、结构签名与已有配方不同 |
| 新增规则动作 | `QuickAction.run(doc) → ops` | 产出的 ops 均能通过 `validateOp` |
| 后端接口 | `server/*.ts`，错误用 `{status}` | 补充单元测试 |

## 流程

```bash
git worktree add ../xiumi-wt-<task> -b worker/<task>
# Worker 在该目录内完成任务，只改动任务声明的文件
pnpm check     # lint + typecheck + 单元测试
pnpm e2e       # E2E + 截图回归（改动 UI 时）
```

主脑审查清单：

1. 只改动了声明范围内的文件；没有引入未审查的依赖。
2. 编译器输出仍然只有内联样式，`ALLOWED_CSS` 白名单未被绕过。
3. AI 相关改动仍然只产出 ops，不直接写 HTML。
4. 没有提交 `.env`、`data/`、密钥。
5. 截图基线变化需要人工确认是预期的（`pnpm e2e --update-snapshots` 只能由主脑执行）。

审查通过后由主脑合并：`git merge --no-ff worker/<task>`，并删除 worktree。
