import { ref } from 'vue';
import { commandTools, runCommand } from './index';

// WebMCP（W3C 草案）：浏览器原生支持时把同一套命令注册为页面工具
interface ModelContext {
  registerTool(tool: {
    name: string,
    description: string,
    inputSchema: object,
    execute: (args: Record<string, unknown>) => Promise<unknown>
  }, options?: { signal?: AbortSignal }): unknown;
}

const enabledKey = 'flycut.webmcp';

export const webMcpActive = ref(false);

let controller: AbortController | null = null;
let registrations: unknown[] = [];

export function modelContext(): ModelContext | null {
  const context = (document as unknown as { modelContext?: ModelContext }).modelContext
    ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  return typeof context?.registerTool === 'function' ? context : null;
}

export function webMcpEnabled() {
  return localStorage.getItem(enabledKey) !== '0';
}

async function register(context: ModelContext) {
  controller = new AbortController();
  const { signal } = controller;
  registrations = await Promise.all(commandTools.map(({ name, description, inputSchema }) => context.registerTool({
    name,
    description,
    inputSchema,
    async execute(args) {
      try {
        const result = await runCommand(name, args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    }
  }, { signal })));
  webMcpActive.value = true;
}

function unregister() {
  controller?.abort();
  controller = null;
  // 早期草案的 registerTool 返回 { unregister }
  registrations.forEach(item => (item as { unregister?: () => void } | undefined)?.unregister?.());
  registrations = [];
  webMcpActive.value = false;
}

export async function setWebMcpEnabled(enabled: boolean) {
  localStorage.setItem(enabledKey, enabled ? '1' : '0');
  unregister();
  const context = modelContext();
  if (enabled && context) await register(context);
}

export async function startWebMcp() {
  const context = modelContext();
  if (context && webMcpEnabled() && !webMcpActive.value) await register(context).catch(error => console.error(error));
}
