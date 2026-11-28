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

## Importing media and large files

Imported files are processed before they are stored in the browser (OPFS) to save space and keep formats the editor and export handle:

- **Images**: still images are re-encoded as WebP (alpha kept, EXIF orientation applied) and downscaled to a 3840 px long side; the original is kept when it doesn't need downscaling and WebP isn't at least 10% smaller. GIF, SVG and animated PNG/WebP stay as they are.
- **Video**: MOV, WebM, MKV and other non H.264 MP4 files are converted to H.264 MP4 (AAC, or Opus where the browser has no AAC encoder); video with a long side above 1920 px is downscaled to 1920 px. Compatible MP4 up to 1080p is stored unchanged.
- **Audio**: WAV, FLAC and AIFF are converted to M4A (AAC or Opus); other formats stay as they are.
- Only the processed file is stored, not the original. Re-importing the same original file reuses the stored asset.

Large files: everything runs in the browser, so very large media uses a lot of memory and disk quota.

- Files over 2 GB show a warning and are not compressed (an MP4 transcode is held in memory before it's saved), but incompatible formats are still converted.
- `.flycut` packages and JianYing drafts are built in memory and don't support more than 4 GB in total.
- The local MCP `import_file` command accepts files up to 512 MB.

## AI access (MCP)

Editing commands (read the timeline, import assets, add/update/trim/split/delete clips, undo, export) are defined once in `src/commands/tools.json` and shared by every non-UI caller.

**Local MCP server** (Claude Desktop, Cursor, ...):

1. Add to your MCP client config:
   ```json
   { "mcpServers": { "flycut": { "command": "node", "args": ["/path/to/flycut/mcp/index.mjs"] } } }
   ```
2. Open FlyCut in the browser, click "AI" in the header and turn on "本地 MCP 服务". The editor connects to `ws://127.0.0.1:4010`.

Only pages listed in `FLYCUT_ALLOWED_ORIGINS` (default `http://localhost:4008,http://127.0.0.1:4008`) may connect; change the port with `FLYCUT_MCP_PORT`. The local server adds an `import_file` tool that imports a file by absolute path.

**WebMCP**: when the browser exposes `document.modelContext` (W3C WebMCP draft), the same commands are registered as page tools; they can be turned off in the "AI" menu.

## Animations

Video, image and text clips have entrance, exit and loop animations (属性 → 动画, or the MCP `set_animation` command): fade, slide, zoom, pop, blur, rotate, typewriter for text, and pulse, float, shake, flicker, spin loops. They are evaluated with paused [anime.js](https://animejs.com) timelines seeked to each frame, so the preview and the exported MP4 show the same motion.

## JianYing (剪映) draft export

Project menu → 导出剪映草稿 downloads a zip containing a draft folder (`draft_content.json`, `draft_meta_info.json`, `materials/`). Enter JianYing's draft location (全局设置 → 草稿位置) when exporting and unzip the archive there so media paths resolve; otherwise relink media in JianYing. Video, image, audio and text clips keep their timing, trim, position, scale and mute state; text size is an approximate conversion. Flycut animations are not exported, because JianYing animations use its own effect resource IDs; add them in JianYing. The draft is plain JSON, which JianYing 5.9 and newer versions open.
