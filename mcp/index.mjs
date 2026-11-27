#!/usr/bin/env node
/* eslint-env node */
// FlyCut 本地 MCP 服务：通过 stdio 与 AI 客户端通信，通过 localhost WebSocket 把命令转发给浏览器中打开的编辑器
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// 工具定义与浏览器端命令层共用同一份 JSON
const tools = JSON.parse(await readFile(new URL('../src/commands/tools.json', import.meta.url), 'utf8'));
const port = Number(process.env.FLYCUT_MCP_PORT || 4010);
const allowedOrigins = new Set((process.env.FLYCUT_ALLOWED_ORIGINS || 'http://localhost:4008,http://127.0.0.1:4008')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean));
const maxImportBytes = 512 * 1024 * 1024;
const mimeTypes = {
  '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac'
};

const log = (...args) => console.error('[flycut-mcp]', ...args);

const localTools = [{
  name: 'import_file',
  description: 'Import a local video (MP4), image or audio file into the FlyCut resource library by absolute path. Returns the asset record.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Absolute path on this computer' }},
    required: ['path'],
    additionalProperties: false
  }
}];

let editor = null;
let nextId = 0;
const pending = new Map();

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port,
  // 只接受允许的编辑器页面连接，防止其他网页冒充编辑器
  verifyClient: ({ origin }) => allowedOrigins.has(origin)
});
wss.on('listening', () => log(`waiting for the editor on ws://127.0.0.1:${port}`));
wss.on('error', error => log('WebSocket server error:', error.message));
wss.on('connection', socket => {
  if (editor) editor.close(4000, 'Replaced by a newer editor tab');
  editor = socket;
  log('editor connected');
  socket.on('message', raw => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  socket.on('close', () => {
    if (editor === socket) editor = null;
    pending.forEach(request => request.reject(new Error('The FlyCut editor disconnected')));
    pending.clear();
    log('editor disconnected');
  });
});

function send(name, args) {
  if (!editor || editor.readyState !== editor.OPEN) {
    return Promise.reject(new Error('No FlyCut editor is connected. Open FlyCut in the browser and turn on "本地 MCP 服务" in the AI menu.'));
  }
  const id = ++nextId;
  // 导出和字幕识别（含首次下载模型）耗时较长
  const timeout = ['export_video', 'generate_subtitles'].includes(name) ? 30 * 60e3 : 120e3;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${name} timed out; the editor may still finish it, call get_timeline before retrying`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    editor.send(JSON.stringify({ id, name, args }));
  });
}

let chain = Promise.resolve();

// 命令逐个发给编辑器，超时只计算编辑器实际执行的时间，排队中的命令不会超时后又被执行
function forward(name, args) {
  const run = chain.then(() => send(name, args));
  chain = run.catch(() => {});
  return run;
}

async function importFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('path must be an absolute file path');
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('path is not a file');
  if (info.size > maxImportBytes) throw new Error('File is larger than 512 MB');
  const extension = path.extname(filePath).toLowerCase();
  const data = (await readFile(filePath)).toString('base64');
  return forward('import_asset', { name: path.basename(filePath), mimeType: mimeTypes[extension] || '', data });
}

const server = new Server({ name: 'flycut', version: '0.1.0' }, { capabilities: { tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, async() => ({ tools: [...tools, ...localTools] }));
server.setRequestHandler(CallToolRequestSchema, async({ params }) => {
  const { name, arguments: args = {}} = params;
  try {
    let result;
    if (name === 'import_file') result = await importFile(args.path);
    else if (tools.some(tool => tool.name === name)) result = await forward(name, args);
    else throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
const shutdown = () => {
  wss.close();
  process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
