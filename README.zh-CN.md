# fly-cut

## 简介
基于Webcodecs + Vue3实现的Web端剪辑工具 <br/>
如果有用请 🌟 Star 🌟 支持一下哟 🫣 <br/>

网站：[flycut.co](https://flycut.co)

## 功能
![](coverImage/map.png)

FlyCut 会自动在当前浏览器中保存最近一次的时间轴和导入素材。重新打开同一站点即可继续编辑；清除站点数据会删除本地草稿。

## 预览
![](coverImage/preview.gif)

## 参考
- https://github.com/Vanilagy/mediabunny 基于 WebCodecs 在浏览器中读取、解码和编码音视频；用来处理音视频文件
- https://github.com/Cc-Edit/CcClip 使用Vue3 + ffmpeg实现的Web剪辑工具，本项目主题功能基于本项目开发

## 许可协议
[AGPL-3.0](LICENSE)。源自 CcClip 的代码保留其 Apache-2.0 声明，见 [NOTICE](NOTICE)。

## AI 调用（MCP）

编辑器的编辑命令（读取时间轴、导入素材、添加/修改/裁剪/分割/删除片段、撤销、导出）定义在 `src/commands/tools.json`，界面之外的调用方共用这一套命令。

**本地 MCP 服务**（Claude Desktop、Cursor 等）：

1. 在 AI 客户端的 MCP 配置中加入：
   ```json
   { "mcpServers": { "flycut": { "command": "node", "args": ["/path/to/flycut/mcp/index.mjs"] } } }
   ```
2. 在浏览器中打开 FlyCut，点顶部的 “AI”，打开 “本地 MCP 服务”。编辑器通过 `ws://127.0.0.1:4010` 连接本地服务。

服务只接受 `FLYCUT_ALLOWED_ORIGINS`（默认 `http://localhost:4008,http://127.0.0.1:4008`）中的页面连接；端口可用 `FLYCUT_MCP_PORT` 修改。本地服务额外提供 `import_file` 工具，可以按绝对路径导入本机文件。

**WebMCP**：浏览器提供 `document.modelContext`（W3C WebMCP 草案）时，同一套命令会自动注册为页面工具，可以在 “AI” 菜单中关闭。
