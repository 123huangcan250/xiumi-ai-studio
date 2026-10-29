# 第三方声明

## 移植或参考了代码逻辑

| 项目 | 许可证 | 用途 | 位置 |
|---|---|---|---|
| [andrewlaredo/wechat-draft-publisher](https://github.com/andrewlaredo/wechat-draft-publisher) | MIT | `draft/add` 入参结构、正文 2 万字符 / 1MB 校验、素材上传与 errcode 中文提示的思路 | `server/wechat.ts` |
| [doocs/md](https://github.com/doocs/md) | WTFPL | 富文本剪贴板写入（ClipboardItem + execCommand 兜底）、首尾零高度段落、复制时只用浅色/内联样式的做法 | `src/editor/wechatOutput.ts` |

MIT License (wechat-draft-publisher) — Copyright (c) andrewlaredo. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to the condition that the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## 仅参考设计思路（未复制代码）

- [zhouke0929/wechat-visual-director](https://github.com/zhouke0929/wechat-visual-director)（Apache-2.0）：主题包按角色声明版式、主题不接收任意 CSS 的安全边界。
- [imraywang/wewrite](https://github.com/imraywang/wewrite)（MIT）：内容流水线拆分、发布权限闸门。
- [loki2046-mao/wechat-layout-editor](https://github.com/loki2046-mao/wechat-layout-editor)（MIT）：色板结构。

## 未使用

- [vima-tech/moka](https://github.com/vima-tech/moka)：仓库没有许可证（默认保留所有权利），未复制其任何代码、模板或素材。
- 秀米：专有模板与素材，未使用。

## npm 依赖

运行时依赖均为 MIT / BSD / Apache-2.0 许可：react、zustand、@dnd-kit、@tiptap（MIT）、marked（MIT）、mammoth（BSD-2-Clause）、sharp（Apache-2.0，内含 libvips LGPL-3.0 动态库）、express、multer、nanoid、react-easy-crop（MIT）。
