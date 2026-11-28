import { ref } from 'vue';
import { runCommand } from './index';

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'replaced' | 'unpaired' | 'insecure';

const enabledKey = 'flycut.mcpBridge';
const portKey = 'flycut.mcpPort';
const codeKey = 'flycut.mcpCode';
const retryMs = 3000;

export const bridgeStatus = ref<BridgeStatus>('off');
export const bridgePort = Number(localStorage.getItem(portKey)) || 4010;

let socket: WebSocket | null = null;
let retry: number | undefined;

const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

function randomHex() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

const keys = new Map<string, Promise<CryptoKey>>();

/** 与本地服务相同：配对码经 PBKDF2 派生出 HMAC 密钥 */
function pairingKey(code: string) {
  let key = keys.get(code);
  if (!key) {
    const encoder = new TextEncoder();
    key = crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey'])
      .then(base => crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: encoder.encode('flycut-mcp-pairing'), iterations: 200000, hash: 'SHA-256' },
        base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']
      ));
    keys.set(code, key);
  }
  return key;
}

async function hmac(code: string, message: string) {
  const signature = await crypto.subtle.sign('HMAC', await pairingKey(code), new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function pairingCode() {
  return localStorage.getItem(codeKey) ?? '';
}

export function bridgeEnabled() {
  return localStorage.getItem(enabledKey) === '1';
}

function connect() {
  window.clearTimeout(retry);
  // 非 localhost 的 HTTP 页面没有 crypto.subtle，无法完成配对
  if (!window.crypto?.subtle) {
    bridgeStatus.value = 'insecure';
    return;
  }
  if (!pairingCode()) {
    bridgeStatus.value = 'unpaired';
    return;
  }
  bridgeStatus.value = 'connecting';
  const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
  socket = ws;
  const clientNonce = randomHex();
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', nonce: clientNonce }));
  };
  ws.onmessage = async({ data }) => {
    let request: { id: number, name: string, args?: Record<string, unknown>, type?: string, nonce?: string, proof?: string };
    try {
      request = JSON.parse(String(data));
    } catch {
      return;
    }
    if (request.type === 'challenge') {
      // 先确认服务知道配对码，再发出自己的证明；配对码本身从不发送
      const code = normalizeCode(pairingCode());
      const serverNonce = String(request.nonce ?? '');
      const expected = await hmac(code, `flycut-pair:server:${clientNonce}:${serverNonce}`);
      if (request.proof !== expected) {
        ws.close(4001, 'The server does not know the pairing code');
        return;
      }
      ws.send(JSON.stringify({ type: 'pair', proof: await hmac(code, `flycut-pair:client:${clientNonce}:${serverNonce}`) }));
      return;
    }
    if (request.type === 'paired') {
      bridgeStatus.value = 'connected';
      return;
    }
    if (bridgeStatus.value !== 'connected') return;
    try {
      const result = await runCommand(request.name, request.args ?? {});
      ws.send(JSON.stringify({ id: request.id, result }));
    } catch (error) {
      ws.send(JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) }));
    }
  };
  ws.onclose = ({ code }) => {
    if (socket !== ws) return;
    socket = null;
    // 4000：另一个标签页接管了连接，本页不再重连，避免两个标签页互相抢占
    if (code === 4000) {
      bridgeStatus.value = 'replaced';
      return;
    }
    // 4001：配对码错误，等用户重新输入，不再重连
    if (code === 4001) {
      bridgeStatus.value = 'unpaired';
      return;
    }
    // 本地服务未启动或被关闭时，定时重连
    if (bridgeEnabled()) {
      bridgeStatus.value = 'connecting';
      retry = window.setTimeout(connect, retryMs);
    } else bridgeStatus.value = 'off';
  };
}

export function setBridgeEnabled(enabled: boolean) {
  localStorage.setItem(enabledKey, enabled ? '1' : '0');
  window.clearTimeout(retry);
  if (enabled) {
    if (!socket) connect();
    return;
  }
  const ws = socket;
  socket = null;
  ws?.close();
  bridgeStatus.value = 'off';
}

export function startBridge() {
  if (bridgeEnabled() && !socket) connect();
}

/** 保存本地 MCP 服务显示的配对码并重新连接 */
export function setPairingCode(code: string) {
  localStorage.setItem(codeKey, code.trim());
  if (!bridgeEnabled()) return;
  const ws = socket;
  socket = null;
  ws?.close();
  connect();
}
