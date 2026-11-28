# Flycut

## 简介
在浏览器里运行的视频剪辑工具（Vue 3 + WebCodecs），素材和工程都保存在本地，不上传服务器。<br/>
如果有用请 🌟 Star 🌟 支持一下哟 🫣 <br/>

网站：[flycut.co](https://flycut.co)

## 预览
![](coverImage/preview.gif)

## 功能（v2）
- **资源库**：导入的视频、图片、音频先进入资源列表，自动压缩转码并生成封面和波形，再从列表拖到时间轴。
- **时间轴**：基于 [@flycut/timeline-kit](https://github.com/x007xyz/timeline-kit)，支持多轨道、拖动、裁剪、分割、吸附、撤销重做和快捷键。
- **画布**：预览和导出共用同一套 Canvas 渲染（`drawFrame`），画面一致；在画布上直接拖动、缩放片段。
- **文字和动画**：文字样式、入场/出场/循环动画（[anime.js](https://animejs.com)）。
- **字幕**：浏览器内用 Whisper（Transformers.js）识别字幕，支持 SRT 导入导出。
- **导出**：用 [MediaBunny](https://github.com/Vanilagy/mediabunny) 导出 MP4；也可以导出剪映草稿。
- **工程**：工程和素材存在浏览器 OPFS 中，自动保存，支持多个工程和 `.flycut` 工程包导入导出。
- **AI**：本地 MCP 服务（配对码认证）和 WebMCP，AI 可以导入素材、编辑时间轴、生成字幕和导出。

## 开发
```bash
pnpm install
pnpm dev          # http://localhost:4008
pnpm test:unit    # Vitest
pnpm test:e2e     # Playwright
```

## 参考
- https://github.com/Vanilagy/mediabunny 基于 WebCodecs 在浏览器中读取、解码和编码音视频；用来处理音视频文件
- https://github.com/Cc-Edit/CcClip 使用Vue3 + ffmpeg实现的Web剪辑工具，本项目主题功能基于本项目开发

## 许可协议
[AGPL-3.0](LICENSE)。源自 CcClip 的代码保留其 Apache-2.0 声明，见 [NOTICE](NOTICE)。

## 导入素材与大文件

导入的文件会先处理再存进浏览器（OPFS），以节省空间，并转成编辑和导出都支持的格式：

- **图片**：静态图片重新编码为 WebP（保留透明，按 EXIF 方向摆正），长边超过 3840 px 的缩小到 3840 px；不需要缩小且 WebP 没有小 10% 以上时保留原图。GIF 和动图 PNG/WebP 保持原样；SVG 栅格化为 WebP（长边至少 1080 px）。
- **视频**：MOV、WebM、MKV 以及不是 H.264 的 MP4 会转成 H.264 MP4（音频为 AAC；浏览器没有 AAC 编码器时用 Opus）；长边超过 1920 px 的缩小到 1920 px。1080p 以内的兼容 MP4 原样保存；带透明通道的 WebM 也原样保存，因为 H.264 不支持透明。
- **音频**：WAV、FLAC、AIFF 转成 M4A（AAC 或 Opus），其他格式保持原样。
- 只保存处理后的文件，不保留原文件。再次导入同一个原文件会直接使用已保存的素材。

大文件：所有处理都在浏览器里完成，很大的素材会占用大量内存和存储配额。

- 超过 2 GB 的文件导入时会提示，并且不做压缩（转码结果要先放在内存里再保存），但不兼容的格式仍会转换。
- `.flycut` 工程包和剪映草稿在内存中打包，总大小不能超过 4 GB。
- 本地 MCP 的 `import_file` 命令只接受 512 MB 以内的文件。

## AI 调用（MCP）

编辑器的编辑命令（读取时间轴、导入素材、添加/修改/裁剪/分割/删除片段、撤销、导出）定义在 `src/commands/tools.json`，界面之外的调用方共用这一套命令。

**本地 MCP 服务**（Claude Desktop、Cursor 等）：

1. 在 AI 客户端的 MCP 配置中加入：
   ```json
   { "mcpServers": { "flycut": { "command": "node", "args": ["/path/to/flycut/mcp/index.mjs"] } } }
   ```
2. 在浏览器中打开 FlyCut，点顶部的 “AI”，打开 “本地 MCP 服务”，输入一次配对码（浏览器会记住）。编辑器通过 `ws://127.0.0.1:4010` 连接本地服务。

配对码用来防止本机其他程序冒充编辑器或本地服务：双方用随机数和 HMAC 互相证明知道配对码，配对码本身不会通过连接发送（HMAC 密钥经 PBKDF2 派生，增加穷举难度）。配对需要安全上下文：通过 `localhost` 或 HTTPS 打开 FlyCut。服务首次运行时生成，保存在 `~/.flycut/mcp-pairing-code`（只有当前用户可读）；服务启动时会打印在日志里，也可以让 AI 调用 `get_pairing_code` 获取。可以用环境变量 `FLYCUT_MCP_CODE` 指定自己的配对码。

服务只接受 `FLYCUT_ALLOWED_ORIGINS`（默认 `http://localhost:4008,http://127.0.0.1:4008`）中的页面连接；端口可用 `FLYCUT_MCP_PORT` 修改。本地服务额外提供 `import_file` 工具，可以按绝对路径导入本机文件。

**WebMCP**：浏览器提供 `document.modelContext`（W3C WebMCP 草案）时，同一套命令会自动注册为页面工具，可以在 “AI” 菜单中关闭。

## 快捷键

| 按键 | 操作 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| ← / → | 上一帧 / 下一帧（按住 Shift 为 1 秒） |
| Home / End | 跳到开头 / 结尾 |
| Ctrl/⌘ + B | 在播放头处分割选中的视频 |
| Delete / Backspace | 删除选中的片段 |
| Ctrl/⌘ + Z，Ctrl/⌘ + Shift + Z 或 Ctrl/⌘ + Y | 撤销，重做 |
| Ctrl/⌘ + = / - | 放大 / 缩小时间轴 |
| Esc | 取消选中 |

## 动画

视频、图片和文字片段支持入场、出场和循环动画（属性 → 动画，或 MCP 命令 `set_animation`）：淡入淡出、滑入滑出、缩放、弹出、模糊、旋转、文字逐字出现，以及呼吸、浮动、摇摆、闪烁、旋转循环。动画用暂停的 [anime.js](https://animejs.com) 时间轴按帧 seek 计算，预览和导出的 MP4 画面一致。

## 导出剪映草稿

工程菜单 → 导出剪映草稿，会下载一个包含草稿文件夹（`draft_content.json`、`draft_meta_info.json`、`materials/`）的 zip。导出时填写剪映的草稿位置（全局设置 → 草稿位置），并把 zip 解压到该目录，素材即可自动链接；否则需要在剪映中重新链接素材。视频、图片、音频和文字片段会保留时间、裁剪、位置、缩放和静音设置，文字字号是近似换算。动画会换成剪映内置的相近免费动画（如淡入 → 渐显、从左滑入 → 向右滑动、逐字出现 → 打字机 I），时长不变，缓动曲线不保留。剪映没有对应效果的动画（视频循环动画、视频模糊进入/消失、文字旋转进入/消失、文字呼吸）会省略，导出后弹窗列出。动画 ID 取自 pyJianYingDraft 的元数据，未在真实剪映中核对。草稿为明文 JSON，剪映 5.9 及新版本都能打开。
