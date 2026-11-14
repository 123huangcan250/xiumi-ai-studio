# 编辑回放 · 接入现有架构说明

本文回答开工前的四个问题，并列出新模板和现有架构冲突的地方及处理方案。数据模型见 [src/core/replay/types.ts](../../src/core/replay/types.ts)，实现在 [src/core/replay/](../../src/core/replay/)。

## 1. 组件注册方式

Studio 没有单独的“组件注册表”，一个模块类型由下面几处共同定义：

| 位置 | 作用 |
|---|---|
| [src/core/types.ts](../../src/core/types.ts) | `BlockType` 联合类型 + `BlockPropsMap`（每种模块的属性结构）。文档是 `Doc { blocks: Block[] }`，是编辑器、AI、编译器共用的唯一数据源 |
| [src/core/blocks.ts](../../src/core/blocks.ts) | `META`：名称、图标、分组、默认值；`coerceProps` / `normalizeBlocks`：加载项目、版本、模板和 AI 输出时的字段校验与修复（相当于 schema） |
| [src/core/compiler.ts](../../src/core/compiler.ts) | `compileBlock`：模块 → 全内联样式 HTML。画布、手机预览、复制、草稿箱都用这一份输出 |
| [src/editor/PropsForm.tsx](../../src/editor/PropsForm.tsx) | 右侧属性面板，按 `block.type` 分支 |
| [src/editor/LeftPanel.tsx](../../src/editor/LeftPanel.tsx) | 左侧模块库：按 `META.group` 分组列出 `BLOCK_TYPES`，点击插入或拖入画布 |
| [src/editor/Canvas.tsx](../../src/editor/Canvas.tsx) | 画布：`dangerouslySetInnerHTML` 渲染 `compileBlock` 的结果 |
| [src/core/ops.ts](../../src/core/ops.ts)、[exporters.ts](../../src/core/exporters.ts)、[assemble.ts](../../src/core/assemble.ts) | AI 修改操作校验、Markdown 导出、模板填充里按类型分支的地方 |

**接入方案**：新增 `BlockType = 'replay'`，属性就是 `ReplayDoc`。分组新增「动效」。`coerceProps('replay', …)` 委托给 `normalizeReplay`（schema 校验 + 默认值）。编译走 `compileBlock`，属性面板在 `PropsForm` 里加一个分支（组件单独成文件）。

## 2. 导出管线

1. `compileDoc(doc, { mapImage })` 生成全内联样式的 HTML。图片地址先加上裁切参数（`/media/x.jpg?fit=4:3&w=1080`），再交给 `mapImage` 换成最终地址。
2. [src/editor/wechatOutput.ts](../../src/editor/wechatOutput.ts) 的 `compileForWechat(doc, mode)` 有三种图片模式：
   - `embed`：本地图片转成 base64 内嵌。
   - `wechat`：调用 `POST /api/wechat/upload-images`，服务端 [server/wechat.ts](../../server/wechat.ts) `uploadContentImage` 用 `media/uploadimg` 上传（≤1MB 的 jpg/png，超出时由 `wechatReady` 压缩），返回 `mmbiz.qpic.cn` 地址并按本地地址缓存，然后由 `mapImage` 替换链接。**会上传并替换链接**。注意这个接口是“图文消息内的图片”，不占永久素材库额度，但地址同样在 `mmbiz.qpic.cn`。
   - `absolute`：换成本机绝对地址，只用于本机预览。
3. 输出方式：
   - `copyRichText`：`ClipboardItem` 写入 text/html，用户粘贴到公众号后台。用户已实测可用。
   - 推送草稿箱：`/api/wechat/draft`，需要界面勾选确认。接口正文有 2 万字符上限。
   - 导出给秀米、导出 HTML 文件。
4. `lintWechatHtml` 做静态检查，结果作为 warnings 显示在导出面板。

**接入方案**：回放模块的所有图片（背景图、image 元素、栅格化后的文字图）都经过同一个 `mapImage`，因此会自动走现有的上传和替换流程。文字栅格化产生的 PNG 是 `data:` 地址，导出时多一步：先通过新接口 `POST /api/replay/glyphs` 存成 `/media/rp-<hash>.png`（不出现在素材列表里），再交给现有的微信上传。

## 3. 预览与测试

- **预览**：
  - 画布（与导出相同的 HTML）。
  - 「手机预览」（375 宽手机框）。
  - 「导出 HTML 文件」（独立页面，模拟文章页宽度）。
- **单元测试**：Vitest，`tests/unit/*.test.ts`，jsdom 解析输出做结构断言。
- **E2E 与视觉回归**：Playwright + Chromium，`tests/e2e/*.spec.ts`。使用独立端口 5273/5274 和独立数据目录 `data-e2e`（每次清空）。`toHaveScreenshot` 首次生成基线，之后比对，`maxDiffPixelRatio` 为 0.01。
- **命令**：`pnpm check`（lint + typecheck + unit）、`pnpm e2e`。

**接入方案**：

- 预览器用 `svg.pauseAnimations()` + `setCurrentTime()` 做时间轴拖动。
- 视觉回归在同一个预览器里按时间点截图，所以截图是确定的，不依赖真实播放速度。

## 4. id 属性与跨元素触发

已核实的事实：

- Studio 自己的编译器不输出 `id`，`lintWechatHtml` 遇到 `id` 会警告。
- 导入公众号推文时，[src/core/sanitize.ts](../../src/core/sanitize.ts) 会删掉 HTML 和 SVG 上的 `id`、`class`。所以 `data/` 里保存的导入内容**不能**用来判断微信是否保留 `id`，原始证据已经被我们自己的清洗删掉了。
- 本机 `data/` 里 4 份导入内容中共有 36 个 `<animate>`/`<animateTransform>`，`begin` 全部是 `0s`，没有点击触发。这和“公众号 SVG 动效多用时间触发”的常见做法一致，但不能证明 `id` 会被删。
- `docs/03-wechat-compat-test.md` 和 `docs/05-xiumi-compat-probe.md` 里都没有 SVG 动效、`id`、`begin="x.click"` 的实测记录。
- 本次尝试抓取用户之前提供的公众号文章原始 HTML 来检查 `id`，请求被会话权限拦截，**没有拿到结果**。

结论：**`id` 是否保留、`begin="start.click+Xs"` 能否生效，目前未知**。因此：

- 默认使用方案 B（`trigger: "auto"`，全部 `begin="Xs"`），不依赖任何 `id`。
- 方案 A（`trigger: "tap"`）照样实现，可在属性面板切换。导出时 linter 给出“依赖 id，待真机验证”的警告。
- `clipPath`、`linearGradient` 等 `url(#id)` 写法只在方案 A 下使用；方案 B 用不依赖 `id` 的替代实现（见下）。
- 真机验证项写进 [COMPAT.md](COMPAT.md)。

## 冲突与处理方案

| 冲突 | 处理 |
|---|---|
| `css()` 只允许 HTML 内联样式白名单，不适用于 SVG | SVG 只用展示属性（`fill`、`stroke`、`opacity`、`transform` 等），单独写 `svgAttrs()` 序列化；外层 `<section>` 仍用 `css()` |
| 编译器是同步纯函数，但文字测量、栅格化需要浏览器 canvas | 新增运行环境注入 `setReplayEnv({ measure, rasterize })`，浏览器在 `main.tsx` 注入 canvas 实现（`measureText` 和 `toDataURL` 都是同步的）。Node（单元测试、服务端）用近似测量；没有栅格化能力时 image 模式退回 svg-text，并给出警告 |
| 栅格化文字是 `data:` 地址，现有微信上传只处理 `/media/` | 导出时先把 `data:image/png` 存为 `/media/rp-<hash>.png`（新接口，按内容哈希去重），再走现有上传 |
| 画布每次重渲染都会重置 `innerHTML`，SMIL 会从头播 | 画布上的回放模块定格在最后一帧，显示「▶ 预览动效」按钮，在预览器里播放和拖动 |
| SMIL 不生效或被过滤时内容会消失 | 所有元素的**基础属性写终态**，动画从 0s 开始把它压回初始态再播到终态。动画被删掉时退化为静态成稿，不会白屏。方案 A 额外用 `<set begin="0s">` 在点击前隐藏 |
| 草稿箱接口 2 万字符上限 | 回放 SVG 远超此限，现有警告会提示；回放模块请用复制粘贴 |
| AI 修改只认结构化操作 | 回放模块对 AI 只读（与原文片段相同），`validateOp` 拒绝插入和修改，`summarize` 输出文字摘要供 AI 参考 |
| 秀米导出不接受内嵌图片 | 栅格化文字在秀米里会变成占位图；回放模块请直接复制粘贴到公众号，导入秀米未测试 |
| 圆角图片需要 `clipPath` | 方案 B 下图片保持直角；方案 A 下可用 `clipPath` |
| 渐变背景需要 `linearGradient` | 方案 B 用 32 条横向色带近似；方案 A 用 `linearGradient` |
| 现有 lint 只有 warnings | 回放 lint 分为错误和警告：错误以「编辑回放 ✕」开头，导出面板在有错误时禁止复制 |

## 动画写法约定

- 每个动画都是一组“绝对时间关键帧”，由序列化函数按模式输出：
  - 方案 B（单次）：`begin="0s" dur="终点s" keyTimes="…" fill="freeze"`。
  - 方案 B（循环）：`dur="场景时长 + hold"`、`repeatCount="indefinite"`，所有动画共用同一个 `dur`。
  - 方案 A：`begin="<场景 id>.click"`，其余同单次。
- 起点前补一个保持帧，所以“在 Xs 开始”体现在 `keyTimes` 里，所有动画都从 0 开始计时。这和“`begin="Xs"`”在视觉上等价，同时能统一处理循环模式。
- 只使用 `<animate>`、`<animateTransform>`、`<set>`；`calcMode` 只用 `linear`、`spline`、`discrete`。
