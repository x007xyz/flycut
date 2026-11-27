import { test, expect } from '@playwright/test';

const srt = `1
00:00:00,500 --> 00:00:01,200
第一句字幕

2
00:00:01,300 --> 00:00:02,000
Second line
`;

test('SRT import adds subtitle text clips and export writes them back', async({ page }) => {
  await page.goto('/');
  await page.locator('.tabsToggle').getByText('字幕', { exact: true })
    .click();
  await page.locator('.subtitle-panel input[type="file"]').setInputFiles({
    name: 'demo.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt)
  });
  await expect(page.getByText('已导入 2 条字幕')).toBeVisible();
  await expect(page.locator('.tk-track-clip[data-type="text"]')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.locator('.subtitle-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('subtitles.srt');
  const text = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(text).toString()).toBe(srt);
});

test('SRT commands round-trip through the shared command layer', async({ page }) => {
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

  const clips = await call('import_srt', { content: srt });
  expect(clips).toEqual([
    expect.objectContaining({ type: 'text', content: '第一句字幕', start: 0.5, end: 1.2 }),
    expect.objectContaining({ type: 'text', content: 'Second line', start: 1.3, end: 2 })
  ]);
  expect((await call('export_srt')).srt).toBe(srt);

  const [long] = await call('import_srt', { content: '1\n00:00:03,000 --> 00:00:05,000\nAnd so my fellow Americans ask not what your country can do for you\n' });
  const lines = long.content.split('\n');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join(' ')).toBe('And so my fellow Americans ask not what your country can do for you');
  const widest = await page.evaluate(({ text, size }) => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.font = `${size}px Arial`;
    return Math.max(...text.split('\n').map(line => ctx.measureText(line).width));
  }, { text: long.content, size: long.fontSize });
  expect(widest).toBeLessThanOrEqual(180 * 0.9);
});

// 需要联网下载 Whisper 模型，默认跳过：FLYCUT_ASR_E2E=1 pnpm exec playwright test e2e/subtitles.spec.ts
test('Whisper recognises speech on the timeline and adds subtitles', async({ page }) => {
  test.skip(!process.env.FLYCUT_ASR_E2E, 'downloads a speech model');
  test.setTimeout(600000);
  await page.goto('/');
  await page.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  // transformers.js 文档中的公开语音样例（JFK 演讲片段）
  const speech = await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');
  await (await chooser).setFiles({ name: 'speech.wav', mimeType: 'audio/wav', buffer: Buffer.from(await speech.arrayBuffer()) });
  const card = page.locator('.media-card[title="speech.wav"]');
  await expect(card).toHaveCount(1);
  await card.dragTo(page.locator('.trackList'));
  await expect(page.locator('.tk-track-clip[data-type="audio"]')).toHaveCount(1);

  await page.locator('.tabsToggle').getByText('字幕', { exact: true })
    .click();
  await page.locator('.subtitle-generate').click();
  await expect(page.getByText(/已添加 \d+ 条字幕/)).toBeVisible({ timeout: 540000 });
  const clips = page.locator('.tk-track-clip[data-type="text"]');
  await expect(clips).not.toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.locator('.subtitle-export').click();
  const exported = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString();
  expect(exported).toMatch(/country/i);
});
