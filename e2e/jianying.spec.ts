import path from 'node:path';
import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test('exports a JianYing draft with media, placement and text', async({ page }) => {
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

  await page.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser).setFiles(path.resolve('e2e/fixtures/sample.mp4'));
  await expect(page.locator('.media-card[title="sample.mp4"]')).toHaveCount(1);
  await expect(page.locator('.media-loading')).toHaveCount(0);
  const [asset] = await call('list_assets');
  const video = await call('add_clip', { assetId: asset.id, start: 0 });
  await call('update_clip', { clipId: video.id, x: 45, muted: true });
  await call('add_text', { content: '你好剪映', start: 0.5, duration: 1, y: 100, fill: 'black', stroke: 'rgb(255, 0, 0)' });

  await page.locator('.project-menu').click();
  await page.getByText('导出剪映草稿', { exact: true }).click();
  await page.locator('.el-message-box input').fill('C:/JianYing/Drafts');
  const download = page.waitForEvent('download');
  await page.locator('.el-message-box').getByRole('button', { name: '导出' })
    .click();
  const file = await download;
  const zip = unzipSync(new Uint8Array(Buffer.concat(await (await file.createReadStream()).toArray())));
  const folder = file.suggestedFilename().replace(/\.zip$/, '');
  const content = JSON.parse(strFromU8(zip[`${folder}/draft_content.json`]));
  const meta = JSON.parse(strFromU8(zip[`${folder}/draft_meta_info.json`]));

  expect(content.canvas_config).toEqual({ width: 1080, height: 1920, ratio: 'original' });
  expect(meta.draft_fold_path).toBe(`C:/JianYing/Drafts/${folder}`);
  const [material] = content.materials.videos;
  expect(material.type).toBe('video');
  expect(material.path).toMatch(new RegExp(`^C:/JianYing/Drafts/${folder}/materials/`));
  const mediaPath = material.path.replace('C:/JianYing/Drafts/', '');
  expect(zip[mediaPath].length).toBeGreaterThan(1000);

  const videoTrack = content.tracks.find((track: any) => track.type === 'video');
  const [segment] = videoTrack.segments;
  expect(segment.material_id).toBe(material.id);
  expect(segment.target_timerange.start).toBe(0);
  expect(Math.abs(segment.target_timerange.duration - video.end * 1e6)).toBeLessThan(1e5);
  expect(segment.volume).toBe(0);
  expect(segment.clip.transform.x).toBeCloseTo(45 / 90, 3);
  expect(content.materials.speeds.map((speed: any) => speed.id)).toContain(segment.extra_material_refs[0]);

  const textTrack = content.tracks.find((track: any) => track.type === 'text');
  const [textSegment] = textTrack.segments;
  expect(textSegment.target_timerange).toEqual({ start: 500000, duration: 1000000 });
  expect(textSegment.clip.transform.y).toBeCloseTo(-100 / 160, 3);
  const text = content.materials.texts.find((item: any) => item.id === textSegment.material_id);
  expect(JSON.parse(text.content).text).toBe('你好剪映');
  const [style] = JSON.parse(text.content).styles;
  expect(style.fill.content.solid.color).toEqual([0, 0, 0]);
  expect(style.strokes[0].content.solid.color).toEqual([1, 0, 0]);
  // 文字轨在 flycut 中位于视频之上，剪映中排在视频轨之后
  expect(content.tracks.indexOf(textTrack)).toBeGreaterThan(content.tracks.indexOf(videoTrack));
  expect(content.duration).toBe(Math.max(...content.tracks.flatMap((track: any) => track.segments.map((s: any) => s.target_timerange.start + s.target_timerange.duration))));
});
