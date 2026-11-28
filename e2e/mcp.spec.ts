/* global DecompressionStream */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const fixture = path.resolve('e2e/fixtures/sample.mp4');
const port = '4011';

async function startServer() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('mcp/index.mjs')],
    env: { ...process.env, FLYCUT_MCP_PORT: port } as Record<string, string>,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'flycut-e2e', version: '1.0.0' });
  await client.connect(transport);
  const call = async(name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    const [{ text }] = result.content as { text: string }[];
    if (result.isError) throw new Error(text);
    return JSON.parse(text);
  };
  return { client, call };
}

test('the local MCP server edits the project open in the browser', async({ page }) => {
  const { client, call } = await startServer();
  try {
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(expect.arrayContaining(['get_timeline', 'add_text', 'import_file', 'export_video']));
    await expect(call('get_timeline')).rejects.toThrow('No FlyCut editor is connected');

    await page.addInitScript(mcpPort => {
      localStorage.setItem('flycut.mcpBridge', '1');
      localStorage.setItem('flycut.mcpPort', mcpPort);
    }, port);
    await page.goto('/');
    await expect(page.locator('.ai-status')).toHaveAttribute('data-status', 'connected');

    const asset = await call('import_file', { path: fixture });
    expect(asset).toMatchObject({ kind: 'video', name: 'sample.mp4' });
    expect(await call('list_assets')).toEqual([expect.objectContaining({ id: asset.id })]);
    // 导入只进素材列表，不直接放到时间轴
    await expect(page.locator('.tk-track-clip')).toHaveCount(0);
    const video = await call('add_clip', { assetId: asset.id, start: 0 });
    await expect(page.locator('.tk-track-clip[data-type="video"]')).toHaveCount(1);

    const text = await call('add_text', { content: 'Hello MCP', start: 0.5, duration: 1, x: 10 });
    expect(text).toMatchObject({ type: 'text', start: 0.5, end: 1.5, content: 'Hello MCP', x: 10 });
    await expect(page.locator('.tk-track-clip[data-type="text"]')).toHaveCount(1);
    expect(await call('update_clip', { clipId: text.id, y: -40, fontSize: 40 })).toMatchObject({ y: -40, fontSize: 40 });
    await expect(call('update_clip', { clipId: video.id, fontSize: 40 })).rejects.toThrow('apply to text clips');
    await expect(call('update_clip', { clipId: text.id, bogus: 1 })).rejects.toThrow('arguments.bogus is not allowed');
    expect(await call('set_animation', { clipId: text.id, kind: 'in', preset: 'typewriter', duration: 0.4 }))
      .toMatchObject({ animations: { in: { preset: 'typewriter', duration: 0.4 }}});
    await expect(call('set_animation', { clipId: video.id, kind: 'in', preset: 'typewriter' })).rejects.toThrow('typewriter applies to text clips');
    await expect(call('set_animation', { clipId: video.id, kind: 'loop', preset: 'fade' })).rejects.toThrow('not a loop animation preset');
    await expect(call('set_animation', { clipId: video.id, kind: 'in', preset: 'wobble' })).rejects.toThrow('arguments.preset must be one of');

    // 在片段中间的整帧处分割
    const middle = Math.round(Math.round(video.end * 15) / 30 * 1000) / 1000;
    const [head, tail] = await call('split_clip', { clipId: video.id, time: middle });
    expect(head).toMatchObject({ start: 0, end: middle });
    expect(tail).toMatchObject({ start: middle, end: video.end, trimStart: middle });
    await expect(page.locator('.tk-track-clip[data-type="video"]')).toHaveCount(2);
    const trimmed = await call('trim_clip', { clipId: tail.id, trimEnd: 0.1 });
    expect(trimmed).toMatchObject({ start: middle, trimStart: middle, trimEnd: 0.1 });
    expect(trimmed.end).toBeCloseTo(video.end - 0.1, 2);
    await expect(call('trim_clip', { clipId: tail.id, trimStart: video.end })).rejects.toThrow('Trim leaves nothing');

    // 连续两次修改各自一条撤销记录
    await call('update_clip', { clipId: text.id, x: 20 });
    await call('update_clip', { clipId: text.id, x: 30 });
    expect((await call('undo')).clips.find(({ id }: { id: string }) => id === text.id)).toMatchObject({ x: 20 });

    await call('delete_clips', { clipIds: [text.id] });
    await expect(page.locator('.tk-track-clip[data-type="text"]')).toHaveCount(0);
    const restored = await call('undo');
    expect(restored.clips.filter(({ type }: { type: string }) => type === 'text')).toHaveLength(1);
    await expect(page.locator('.tk-track-clip[data-type="text"]')).toHaveCount(1);

    await expect.poll(() => page.evaluate(async() => {
      // 自动保存是异步的，文件还没写入时返回空字符串继续轮询
      try {
        const root = await navigator.storage.getDirectory();
        const id = localStorage.getItem('flycut.currentProject') ?? '';
        const dir = await (await (await root.getDirectoryHandle('flycut')).getDirectoryHandle('projects')).getDirectoryHandle(id);
        const file = await (await dir.getFileHandle('project.json.gz')).getFile();
        return await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      } catch {
        return '';
      }
    })).toContain('Hello MCP');

    const download = page.waitForEvent('download');
    const exported = await call('export_video', { fileName: 'from-mcp.mp4' });
    expect((await download).suggestedFilename()).toBe('from-mcp.mp4');
    expect(exported.size).toBeGreaterThan(1000);
    expect(exported.duration).toBe((await call('get_timeline')).duration);
  } finally {
    await client.close();
  }
});

test('WebMCP registers the same commands when the browser provides document.modelContext', async({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, { execute:(args: unknown) => Promise<unknown> }>();
    (window as any).registeredTools = tools;
    (document as any).modelContext = {
      registerTool(tool: { name: string, execute:(args: unknown) => Promise<unknown> }, { signal }: { signal: AbortSignal }) {
        tools.set(tool.name, tool);
        signal.addEventListener('abort', () => tools.delete(tool.name));
      }
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => [...(window as any).registeredTools.keys()])).toContain('add_text');
  const result = await page.evaluate(() => (window as any).registeredTools.get('add_text').execute({ content: 'From WebMCP' }));
  expect(JSON.parse(result.content[0].text)).toMatchObject({ type: 'text', content: 'From WebMCP' });
  await expect(page.locator('.tk-track-clip[data-type="text"]')).toHaveCount(1);

  await page.locator('.ai-connect').click();
  await page.locator('.webmcp-switch').click();
  await expect.poll(() => page.evaluate(() => (window as any).registeredTools.size)).toBe(0);
});
