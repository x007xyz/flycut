# fly-cut

## Introduction
A web-based editing tool implemented with Webcodecs + Vue3 <br/>
If you find it useful, please 🌟 Star 🌟 to support it 🫣 <br/>

Website: [flycut.co](https://flycut.co)

## Features
![](coverImage/map.png)

FlyCut automatically saves the latest timeline and its imported media in this browser. Reload the editor on the same site to resume. Clearing the site's data removes the local draft.

## Preview
![](coverImage/preview.gif)

## References
- https://github.com/Vanilagy/mediabunny Reads, decodes and encodes media in the browser based on WebCodecs; used for processing audio and video files
- https://github.com/Cc-Edit/CcClip A web-based editing tool implemented with Vue3 + ffmpeg, the main functionality of this project is based on this project
## License
[AGPL-3.0](LICENSE). Code derived from CcClip keeps its Apache-2.0 notice in [NOTICE](NOTICE).

## AI access (MCP)

Editing commands (read the timeline, import assets, add/update/trim/split/delete clips, undo, export) are defined once in `src/commands/tools.json` and shared by every non-UI caller.

**Local MCP server** (Claude Desktop, Cursor, ...):

1. Add to your MCP client config:
   ```json
   { "mcpServers": { "flycut": { "command": "node", "args": ["/path/to/flycut/mcp/index.mjs"] } } }
   ```
2. Open FlyCut in the browser, click "AI" in the header, turn on "本地 MCP 服务" and enter the pairing code once (the browser remembers it). The editor connects to `ws://127.0.0.1:4010`.

The pairing code stops other programs on the same computer from posing as the editor or as the server: both sides prove they know the code with an HMAC over random nonces, so the code itself is never sent. It is generated on first run and saved in `~/.flycut/mcp-pairing-code` (readable only by you); the server prints it to its log on startup, and the AI client can read it with the `get_pairing_code` tool. Set `FLYCUT_MCP_CODE` to choose your own code.

Only pages listed in `FLYCUT_ALLOWED_ORIGINS` (default `http://localhost:4008,http://127.0.0.1:4008`) may connect; change the port with `FLYCUT_MCP_PORT`. The local server adds an `import_file` tool that imports a file by absolute path.

**WebMCP**: when the browser exposes `document.modelContext` (W3C WebMCP draft), the same commands are registered as page tools; they can be turned off in the "AI" menu.

## Animations

Video, image and text clips have entrance, exit and loop animations (属性 → 动画, or the MCP `set_animation` command): fade, slide, zoom, pop, blur, rotate, typewriter for text, and pulse, float, shake, flicker, spin loops. They are evaluated with paused [anime.js](https://animejs.com) timelines seeked to each frame, so the preview and the exported MP4 show the same motion.

## JianYing (剪映) draft export

Project menu → 导出剪映草稿 downloads a zip containing a draft folder (`draft_content.json`, `draft_meta_info.json`, `materials/`). Enter JianYing's draft location (全局设置 → 草稿位置) when exporting and unzip the archive there so media paths resolve; otherwise relink media in JianYing. Video, image, audio and text clips keep their timing, trim, position, scale and mute state; text size is an approximate conversion. Flycut animations are not exported, because JianYing animations use its own effect resource IDs; add them in JianYing. The draft is plain JSON, which JianYing 5.9 and newer versions open.
