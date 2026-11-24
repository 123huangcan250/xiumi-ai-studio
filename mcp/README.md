# XIUMI AI Studio MCP 服务

让外部 Agent 通过标准接口**查看**和**控制**整条推文流程：新建 → 排版 → 修改 → 导出 → （可选）推送草稿箱。

它是对 XIUMI 自己 REST 接口的薄封装，文档修改走与界面、AI 相同的 `DocOp` 校验，不绕过任何规则。不依赖 MCP SDK，不读取也不输出任何 API 密钥。

## 先启动 XIUMI

MCP 通过本机 API（默认 `http://127.0.0.1:5174`）工作，所以要先运行：

```bash
pnpm dev      # 开发模式；或 pnpm start 运行构建版
```

API 端口不同时，用环境变量 `XIUMI_API` 指定。

## 两种运行方式

| 方式 | 命令 | 适用 |
|---|---|---|
| stdio | `pnpm mcp` | Claude Code、Codex、Antigravity、DSH 等会自己拉起 MCP 子进程的客户端 |
| HTTP | `pnpm mcp --http 5175` | 不支持 stdio 的客户端或其他程序 |

HTTP 模式只监听 `127.0.0.1`，拒绝非本机 Host 和外站 Origin；设置 `XIUMI_MCP_TOKEN` 后要求 `Authorization: Bearer <token>`。接口：

- `POST /mcp`：标准 MCP JSON-RPC（`initialize`、`tools/list`、`tools/call`，支持批量）
- `GET /tools`：工具列表和参数 schema
- `POST /call/<工具名>`：请求体直接是参数 JSON，适合只会发普通 HTTP 请求的 Agent

## 接入示例

> 下面各客户端的配置写法来自它们的通用约定，**我只验证了本服务的 stdio 和 HTTP 接口本身**，没有在这些客户端里逐个实测。如果某个客户端的配置格式不同，以它的文档为准，命令和参数不变。

**Claude Code**

```bash
claude mcp add xiumi -- pnpm --dir E:/claude_code/xiumi-ai-studio mcp
```

**Codex**（`~/.codex/config.toml`）

```toml
[mcp_servers.xiumi]
command = "pnpm"
args = ["--dir", "E:/claude_code/xiumi-ai-studio", "mcp"]
```

**Antigravity / DSH / 其他使用 `mcpServers` JSON 的客户端**

```json
{
  "mcpServers": {
    "xiumi": {
      "command": "pnpm",
      "args": ["--dir", "E:/claude_code/xiumi-ai-studio", "mcp"]
    }
  }
}
```

**豆包等不支持本地 MCP 的 Agent**：运行 `pnpm mcp --http 5175`，让它用 `POST http://127.0.0.1:5175/call/<工具名>` 调用，工具和参数见 `GET /tools`。

## 工具

查看：`xiumi_status`、`xiumi_list_projects`、`xiumi_get_project`、`xiumi_get_block`、`xiumi_list_versions`、`xiumi_list_assets`、`xiumi_list_themes`、`xiumi_list_templates`、`xiumi_list_components`

创建与修改：`xiumi_upload_asset`（上传本机图片）、`xiumi_create_project`（文稿自动排版，可选 AI）、`xiumi_apply_ops`（支持 `dry_run` 和 `revision` 防覆盖）、`xiumi_save_version`、`xiumi_ai_edit`、`xiumi_delete_project`

导出：`xiumi_compile`（公众号 HTML，可内嵌图片、可写文件）、`xiumi_export_markdown`、`xiumi_wechat_push_draft`

推荐流程：`xiumi_status` → `xiumi_create_project` → `xiumi_get_project` → `xiumi_apply_ops` / `xiumi_ai_edit` → `xiumi_compile`。

## 安全闸门

- **删除**项目必须带 `confirm:true`，调用方应先取得用户同意。
- **推送公众号草稿箱**默认禁用。要开放，由用户在启动 MCP 时设置 `XIUMI_MCP_ALLOW_PUBLISH=1`，并且每次调用仍要带 `confirm:true`。还需要已配置公众号接口并设置封面。
- AI 类工具（`use_ai`、`xiumi_ai_edit`）使用 XIUMI 里已配置的模型，会产生调用费用；先用 `xiumi_status` 看 `ai.enabled`。

## 验证状态

已验证（临时数据目录和用户真实后端各跑过一遍）：stdio 握手、18 个工具列表、上传图片、新建项目（本地规则，以及 **AI 排版：真实调用 DeepSeek**）、**AI 修改建议**、读取、`apply_ops` 的 dry-run 和真实修改（插入/删除/更新）、编译 HTML（内嵌图片后渲染成手机宽度截图逐段检查）、导出 Markdown、存版本、删除闸门、推送禁用、HTTP 三个入口与本机防护。

真实运行中发现并修复了两处问题：内嵌图片时地址映射对不上（编译用的图片地址带裁切参数）；推送草稿箱的图片上传存在同样的映射问题。

**未验证**：`xiumi_wechat_push_draft`（公众号凭据已配置，但未经用户明确授权不应实际推送）、在各个真实客户端（Codex、Antigravity、豆包、DSH）里的接入，以及导出 HTML 在微信里的实际显示。
