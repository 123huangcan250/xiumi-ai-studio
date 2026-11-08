# EEA × Germany 公众号模板库（独立 HTML）

清华大学电机系赴德国海外社会实践支队的推文模板：9 类、15 个可单独复制的模块（刊头、H1/H2、分割线、大型自适应文本框、单图/双图/三图/四图、轮播、尾声铭牌）。

- 用 Chrome / Edge 打开 `eea-germany-template.html`，点模块旁的「📋 复制此模块到公众号」，到公众号后台 Ctrl+V。
- 模块只用行内样式和内联 SVG，不用 class、id、position、CSS Grid；SVG 不依赖 id 引用（渐变用容器 CSS 渐变，网格逐线绘制）。
- SVG 里的装饰文字（英文丝印、坐标、路线站名）需在 `build.mjs` 中修改，然后运行 `node build.mjs` 重新生成。
- 占位图来自 Unsplash，仅供预览，发布前请替换。
- **尚未在公众号后台实测粘贴效果。**

与编辑器内的「清华电机 · 德国实践」套件（`src/core/kit.ts`）是两套独立实现。
