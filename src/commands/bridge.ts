import { ref } from 'vue';
import { runCommand } from './index';

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'replaced' | 'unpaired';

const enabledKey = 'flycut.mcpBridge';
const portKey = 'flycut.mcpPort';
const codeKey = 'flycut.mcpCode';
const retryMs = 3000;

export const bridgeStatus = ref<BridgeStatus>('off');
export const bridgePort = Number(localStorage.getItem(portKey)) || 4010;

let socket: WebSocket | null = null;
let retry: number | undefined;

export function pairingCode() {
  return localStorage.getItem(codeKey) ?? '';
}

export function bridgeEnabled() {
  return localStorage.getItem(enabledKey) === '1';
}

function connect() {
  window.clearTimeout(retry);
  if (!pairingCode()) {
    bridgeStatus.value = 'unpaired';
    return;
  }
  bridgeStatus.value = 'connecting';
  const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
  socket = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'pair', code: pairingCode() }));
  };
  ws.onmessage = async({ data }) => {
    let request: { id: number, name: string, args?: Record<string, unknown>, type?: string };
    try {
      request = JSON.parse(String(data));
    } catch {
      return;
    }
    if (request.type === 'paired') {
      bridgeStatus.value = 'connected';
      return;
    }
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
