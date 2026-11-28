import path from 'node:path';
import { test, expect } from '@playwright/test';

/** 1 秒 44.1 kHz 16 位单声道正弦波 WAV */
function wav() {
  const rate = 44100;
  const data = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i++) data.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 12000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('imports compress oversized images and lossless audio and convert WebM to MP4', async({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, { execute:(args: unknown) => Promise<{ content: { text: string }[] }> }>();
    (window as any).registeredTools = tools;
    (document as any).modelContext = { registerTool: (tool: any) => tools.set(tool.name, tool) };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).registeredTools.size)).toBeGreaterThan(0);
  const call = (name: string, args = {}) => page.evaluate(async({ tool, input }) => {
    const result = await (window as any).registeredTools.get(tool).execute(input);
    return JSON.parse(result.content[0].text);
  }, { tool: name, input: args });

  // 5000×400 的 PNG，长边超过 3840
  const png = await page.evaluate(async() => {
    const canvas = new OffscreenCanvas(5000, 400);
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const gradient = context.createLinearGradient(0, 0, 5000, 0);
    gradient.addColorStop(0, '#ff735c');
    gradient.addColorStop(1, '#111215');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 5000, 400);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return Array.from(bytes);
  });

  await page.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser).setFiles([
    { name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(png) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() }
  ]);
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser2).setFiles(path.resolve('e2e/fixtures/sample.webm'));
  await expect(page.locator('.media-card')).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator('.media-loading')).toHaveCount(0, { timeout: 30000 });

  const assets = await call('list_assets');
  const byKind = (kind: string) => assets.find((asset: any) => asset.kind === kind);
  expect(byKind('image')).toMatchObject({ name: 'wide.webp', format: 'image/webp', width: 3840, height: 307 });
  expect(byKind('audio')).toMatchObject({ name: 'tone.m4a', format: 'audio/mp4' });
  expect(byKind('audio').size).toBeLessThan(wav().length / 2);
  expect(Math.abs(byKind('audio').duration - 1)).toBeLessThan(0.1);
  expect(byKind('video')).toMatchObject({ name: 'sample.mp4', format: 'video/mp4', width: 320, height: 240 });
  expect(Math.abs(byKind('video').duration - 1)).toBeLessThan(0.1);

  // 转换后的视频可以放到时间轴并导出
  const clip = await call('add_clip', { assetId: byKind('video').id, start: 0 });
  expect(clip.end).toBeGreaterThan(0.9);
});
