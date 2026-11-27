import { ref } from 'vue';
import { runCommand } from './index';

export type BridgeStatus = 'off' | 'connecting' | 'connected';

const enabledKey = 'flycut.mcpBridge';
const portKey = 'flycut.mcpPort';
const retryMs = 3000;

export const bridgeStatus = ref<BridgeStatus>('off');
export const bridgePort = Number(localStorage.getItem(portKey)) || 4010;

let socket: WebSocket | null = null;
let retry: number | undefined;

export function bridgeEnabled() {
  return localStorage.getItem(enabledKey) === '1';
}

function connect() {
  window.clearTimeout(retry);
  bridgeStatus.value = 'connecting';
  const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
  socket = ws;
  ws.onopen = () => {
    bridgeStatus.value = 'connected';
  };
  ws.onmessage = async({ data }) => {
    let request: { id: number, name: string, args?: Record<string, unknown> };
    try {
      request = JSON.parse(String(data));
    } catch {
      return;
    }
    try {
      const result = await runCommand(request.name, request.args ?? {});
      ws.send(JSON.stringify({ id: request.id, result }));
    } catch (error) {
      ws.send(JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) }));
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
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
