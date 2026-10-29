# P0 · 参考仓库调研与技术选型

调研日期：2026-10-29。数据来自 `gh api repos/<repo>` 与 `git clone --depth 1` 后的源码阅读。

## 1. 仓库逐一核验

| 仓库 | 许可证 | 活跃度（最后推送 / Star） | 技术栈 | 结论 |
|---|---|---|---|---|
| [doocs/md](https://github.com/doocs/md) | WTFPL | 2026-10-29 / 13.4k | Vue3 + Vite + marked + juice + highlight.js | **复用思路与少量函数**：剪贴板写入（`ClipboardItem` + `execCommand` 回退）、图片 `width/height` 属性转内联样式、首尾零高度占位段落、去掉 `#` 锚点链接、复制前强制浅色。我们直接产出内联样式，无需 juice。 |
| [loki2046-mao/wechat-layout-editor](https://github.com/loki2046-mao/wechat-layout-editor) | MIT | 2026-10-28 / 2 | 单文件 HTML + Python 小服务 | 体量很小，仅参考“6 套色系 = 主色 + 浅底 + 胶囊 + 边框”的色板结构，不复用代码。 |
| [zhouke0929/wechat-visual-director](https://github.com/zhouke0929/wechat-visual-director) | Apache-2.0 | 2026-10-26 / 16 | Python API + Web 工作台 + Agent Skill | **参考设计**：主题包 schema（palette / visual_dna / 按角色声明 layouts）、“主题不接收任意 CSS/HTML”的安全边界、诚实声明“内联样式限制降低风险，不等于已通过微信后台验证”。Python 代码不直接移植。 |
| [imraywang/wewrite](https://github.com/imraywang/wewrite) | MIT | 2026-10-26 / 3.5k | Python CLI + 多个 Skill | **参考流程**：选题→写作→排版→发布的流水线拆分、`set_publish_permission` 发布权限闸门、`wewrite-learn` 从用户修改中学习风格。采用“人工确认后才推送”的同等闸门。 |
| [andrewlaredo/wechat-draft-publisher](https://github.com/andrewlaredo/wechat-draft-publisher) | MIT | 2026-10-21 / 2 | TS + Wails(Go) 桌面端 | **移植接口逻辑**（已在 `THIRD_PARTY_NOTICES.md` 署名）：`draft/add` 入参结构、单次 ≤8 篇、正文 < 20,000 字符 / < 1MB 校验、`material/add_material` 素材上传与常见 errcode 中文提示。 |
| [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | MIT | 2026-10-28 / 38.9k | TS + ProseMirror | **直接依赖**：段落/卡片等富文本字段的编辑内核，存储为 ProseMirror JSON。 |
| [vima-tech/moka](https://github.com/vima-tech/moka) | **无许可证** | 2026-04-24 / 52 | React19 + Vite + Tauri | 未授权即“保留所有权利”：**不复制任何代码、模板或素材**，仅了解其公开功能描述。 |

另外：秀米的模板、素材均为其专有内容，本项目所有模块与主题为原创实现，不抓取、不仿制秀米素材。

## 2. 微信兼容性要点（来源与可信度）

| 规则 | 来源 | 状态 |
|---|---|---|
| 公众号编辑器会剥离 `<script>`、`<style>`、`class` 驱动的样式，必须全部内联 | doocs/md 复制链路、wechat-visual-director 文档 | 业界共识，未在本项目真机验证 |
| `draft/add` 正文必须少于 2 万字符、小于 1MB，且会去除 JS | 微信官方文档；wechat-draft-publisher 校验代码 | 官方约束，已实现校验 |
| 正文图片需先经 `media/uploadimg` 换成 mmbiz 域名 URL，外链图片会被过滤 | 微信官方文档 | 官方约束，已实现接口 |
| 封面需 `material/add_material` 得到 `thumb_media_id` | 官方文档；wechat-draft-publisher | 已实现接口 |
| 非认证号正文外链 `<a>` 会被移除 | 社区经验 | 编译器默认把外链转为“文字（链接）” |
| `position`/`transform`/CSS 变量/外部字体不可靠 | doocs/md 对 `top:` 改写为 `transform`、对 CSS 变量的替换 | 编译器白名单剔除 |
| 两栏布局：`display:inline-block` + `vertical-align:top` 是长期被大量编辑器使用的稳妥写法 | 社区经验 | 采用；`flex` 未使用 |

> **未验证声明**：截至本文件，本项目**未**在真实公众号后台完成粘贴测试（需要你本人登录后台操作）。`docs/03-wechat-compat-test.md` 给出了手动测试步骤与记录表，结果需由人工填写。

## 3. 技术选型

| 层 | 选择 | 原因 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite | 生态成熟；tiptap 官方 React 绑定 |
| 状态 | zustand + 自研快照历史（撤销/重做） | 文档是单一 JSON 树，快照式历史最简单可靠 |
| 拖拽 | @dnd-kit（MIT） | 支持排序 + 从左栏拖入画布 |
| 富文本 | @tiptap/react + starter-kit（MIT） | 成熟编辑内核，JSON 存储便于 AI 操作 |
| Markdown | marked（MIT） | doocs/md 同款，用于导入解析 |
| Word | mammoth（BSD-2） | .docx → HTML/文本 |
| 图片 | sharp（Apache-2.0）+ react-easy-crop（MIT） | 压缩/缩放以满足微信 1MB 限制；裁剪交互 |
| 后端 | Node + Express 5（tsx 运行） | 项目/版本/素材落盘、AI 与微信 API 代理（密钥不进浏览器） |
| AI | OpenAI 兼容 Chat Completions（DeepSeek / MiMo / MiniMax 等）或 Anthropic | 统一 provider 抽象；无密钥时退回确定性规则排版 |
| 测试 | Vitest（单元）+ Playwright（E2E + 截图回归） | |

## 4. 核心架构决策

1. **文档 JSON 是唯一事实来源**：`Doc { title, themeId, blocks: Block[] }`，Block 为 13 种模块之一，富文本字段为 ProseMirror JSON。
2. **一个编译器两处使用**：画布与手机预览渲染的就是 `compileBlock()` 产出的内联样式 HTML，与复制到微信的内容同源，避免“所见非所得”。
3. **AI 只产出操作（ops）**：`insert / update / remove / move / setTheme`，前端展示差异，逐条接受或拒绝；AI 永远不直接写 HTML。
4. **AI 负责理解，代码负责排版**：LLM 抽取文章结构（章节、引语、时间线、数据、人物），三套确定性“版式配方”把结构映射为模块，保证输出始终合法、结构不同。
5. **发布闸门**：草稿箱推送必须由用户在界面上二次确认；微信凭据只从本机 `.env` 读取，前端永远拿不到 AppSecret。
