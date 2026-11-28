#!/usr/bin/env node
/* eslint-env node */
// FlyCut 本地 MCP 服务：通过 stdio 与 AI 客户端通信，通过 localhost WebSocket 把命令转发给浏览器中打开的编辑器
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
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

// 配对码：编辑器连接后必须先发送配对码，防止本机其他程序冒充编辑器接管连接。
// 保存在只有当前用户可读的文件里，重启服务后不变，浏览器只需输入一次
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeFile = process.env.FLYCUT_MCP_CODE_FILE || path.join(homedir(), '.flycut', 'mcp-pairing-code');
async function loadPairingCode() {
  if (process.env.FLYCUT_MCP_CODE) return process.env.FLYCUT_MCP_CODE.trim();
  try {
    const saved = (await readFile(codeFile, 'utf8')).trim();
    if (saved.length >= 8) return saved;
  } catch {
    // 首次运行时生成
  }
  const code = Array.from({ length: 10 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
  await mkdir(path.dirname(codeFile), { recursive: true, mode: 0o700 });
  await writeFile(codeFile, `${code}\n`, { mode: 0o600 });
  await chmod(codeFile, 0o600);
  return code;
}
const pairingCode = await loadPairingCode();
const normalizeCode = code => String(code ?? '').replace(/[\s-]/g, '')
.toUpperCase();
function codeMatches(code) {
  const expected = Buffer.from(normalizeCode(pairingCode));
  const actual = Buffer.from(normalizeCode(code));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const pairTimeoutMs = 5000;

const localTools = [{
  name: 'get_pairing_code',
  description: 'Return the pairing code the FlyCut editor needs to connect to this MCP server (AI menu → 本地 MCP 服务). Show it to the user when the editor asks for it.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}, {
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
wss.on('listening', () => log(`waiting for the editor on ws://127.0.0.1:${port}, pairing code: ${pairingCode}`));
wss.on('error', error => log('WebSocket server error:', error.message));
wss.on('connection', socket => {
  let paired = false;
  // 未在限定时间内发送正确配对码的连接直接关闭，不会顶替已连接的编辑器
  const pairTimer = setTimeout(() => socket.close(4001, 'Pairing code required'), pairTimeoutMs);
  socket.on('message', raw => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!paired) {
      clearTimeout(pairTimer);
      if (message?.type !== 'pair' || !codeMatches(message.code)) {
        log('rejected an editor connection with a wrong pairing code');
        socket.close(4001, 'Wrong pairing code');
        return;
      }
      paired = true;
      if (editor) editor.close(4000, 'Replaced by a newer editor tab');
      editor = socket;
      socket.send(JSON.stringify({ type: 'paired' }));
      log('editor connected');
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
    clearTimeout(pairTimer);
    if (editor !== socket) return;
    editor = null;
    pending.forEach(request => request.reject(new Error('The FlyCut editor disconnected')));
    pending.clear();
    log('editor disconnected');
  });
});

function send(name, args) {
  if (!editor || editor.readyState !== editor.OPEN) {
    return Promise.reject(new Error('No FlyCut editor is connected. Open FlyCut in the browser, turn on "本地 MCP 服务" in the AI menu and enter the pairing code (get_pairing_code).'));
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
    if (name === 'get_pairing_code') result = { pairingCode };
    else if (name === 'import_file') result = await importFile(args.path);
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
