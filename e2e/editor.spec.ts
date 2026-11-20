import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('e2e/fixtures/sample.mp4');
const tracks = '.trackLine[data-type="video"]';
const draftKey = 'flycut.editorDraft';
const textClip = '.trackItem[data-type="text"]';

function readDraft(page: Page): Promise<string | null> {
  return page.evaluate(key => localStorage.getItem(key), draftKey);
}

async function addText(page: Page, content: string) {
  await page.locator('.tabsToggle').getByText('文字', { exact: true })
.click();
  await page.getByText('添加文字', { exact: true }).click();
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await page.getByPlaceholder('请输入内容').fill(content);
}

async function removeClip(page: Page, selector: string) {
  await page.locator(selector).click({ position: { x: 12, y: 14 }});
  await page.keyboard.press('Backspace');
}

async function dropFile(page: Page, name = 'sample.mp4') {
  const bytes = [...readFileSync(path.resolve('e2e/fixtures', name))];
  const dataTransfer = await page.evaluateHandle(({ bytes: fileBytes, name: fileName }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(fileBytes)], fileName, {
      type: fileName.endsWith('.mp4') ? 'video/mp4' : 'text/plain'
    }));
    return transfer;
  }, { bytes, name });
  const timeline = page.locator('.trackList > div').last();
  await timeline.dispatchEvent('dragover', { dataTransfer });
  await timeline.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
}

async function expectImported(page: Page) {
  await expect(page.locator(tracks)).toHaveCount(1);
  await expect.poll(() => page.locator('#player').evaluate((element: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = 160;
    copy.height = 90;
    const ctx = copy.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(element, 0, 0, 160, 90);
    const pixels = ctx.getImageData(0, 0, 160, 90).data;
    return pixels.some((value, index) => index % 4 !== 3 && value > 50);
  })).toBe(true);
}

async function expectIdle(page: Page, pickerCalls: number) {
  await expect(page.locator('.el-loading-mask')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '合成视频' })).toBeEnabled();
  await expect.poll(() => page.evaluate(async() => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (root as any).keys()) names.push(name);
    return names.filter(name => name.startsWith('flycut-export-'));
  })).toEqual([]);
  expect(await page.evaluate(() => (window as any).savePickerCalls)).toBe(pickerCalls);
}

test.beforeEach(async({ page }) => {
  await page.addInitScript(() => {
    (window as any).savePickerCalls = 0;
    (window as any).showSaveFilePicker = async() => {
      (window as any).savePickerCalls++;
      throw new DOMException('User cancelled', 'AbortError');
    };
  });
  await page.goto('/');
});

test('empty project offers MP4 drop and has no tracks', async({ page }) => {
  await expect(page.getByText('将 MP4 视频拖拽到这里，开始编辑你的大作吧~')).toBeVisible();
  await expect(page.locator('.trackLine')).toHaveCount(0);
});

test('MP4 drop creates a video track and renders preview pixels', async({ page }) => {
  await dropFile(page);
  await expectImported(page);
});

test('local video file chooser creates a video track', async({ page }) => {
  await page.getByText('视频', { exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('本地视频', { exact: true }).click();
  await (await chooser).setFiles(fixture);
  await expectImported(page);
});

test('non-MP4 drop warns without creating tracks', async({ page }) => {
  await dropFile(page, 'not-video.txt');
  await expect(page.getByText('请拖入 MP4 视频', { exact: true })).toBeVisible();
  await expect(page.locator('.trackLine')).toHaveCount(0);
});

test('autosave restores split video, edited text and the playhead, then resumes playback', async({ page }) => {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = function(src?: string) {
      const audio = new NativeAudio(src);
      audio.addEventListener('playing', () => {
        document.documentElement.setAttribute('data-test-playing-src', audio.currentSrc);
      });
      return audio;
    } as typeof Audio;
  });
  await dropFile(page);
  await expectImported(page);

  const video = page.locator('.trackItem[data-type="video"]');
  const ruler = page.locator('.trackList canvas');
  const toolbarActions = page.locator('.trackList').locator('..')
.locator('.float-left > div');
  await ruler.click({ position: { x: 29, y: 10 }});
  await video.click({ position: { x: 12, y: 14 }});
  await toolbarActions.nth(2).click();
  await expect(video).toHaveCount(2);

  await addText(page, 'Draft subtitle');
  await page.getByRole('slider').last()
.press('ArrowRight');
  await expect.poll(() => readDraft(page)).toContain('Draft subtitle');
  const saved = JSON.parse(await readDraft(page) ?? '');
  expect(saved.trackScale).toBe(70);
  expect(saved.playhead).toBe(6);
  expect(saved.lines.find((line: { type: string }) => line.type === 'video').tracks).toMatchObject([
    { start: 0, end: 6, trim: { offsetL: 0, offsetR: expect.any(Number) }},
    { start: 6, trim: { offsetL: 6, offsetR: 0 }}
  ]);
  expect(JSON.stringify(saved)).not.toContain('blob:');

  await page.reload();
  await expect(video).toHaveCount(2);
  await expectImported(page);
  await expect(page.getByText('00:00:00:06', { exact: true })).toBeVisible();
  await expect(page.getByRole('slider').last()).toHaveAttribute('aria-valuenow', '70');
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await expect(page.getByPlaceholder('请输入内容')).toHaveValue('Draft subtitle');

  const playControl = page.locator('#player').locator('../..')
.locator('.el-icon > svg:visible');
  await playControl.click();
  await expect(page.locator('html')).toHaveAttribute('data-test-playing-src', /^blob:/);
  await playControl.click();
  await page.getByPlaceholder('请输入内容').fill('Continued after reload');
  await expect.poll(() => readDraft(page)).toContain('Continued after reload');
});

test('deleting the last clip stays deleted after an immediate reload', async({ page }) => {
  await addText(page, 'Do not resurrect');
  await expect.poll(() => readDraft(page)).toContain('Do not resurrect');
  await removeClip(page, textClip);
  await page.reload();
  await expect(page.locator('.trackItem')).toHaveCount(0);
  await expect(page.getByText('将 MP4 视频拖拽到这里，开始编辑你的大作吧~')).toBeVisible();
  expect(JSON.parse(await readDraft(page) ?? '').lines).toEqual([]);
});

test('clearing a numeric text property resets it without invalidating the draft', async({ page }) => {
  await addText(page, 'Keep this text');
  const fontForm = page.locator('.formItem').filter({ hasText: '字号' });
  const fontSize = fontForm.getByRole('spinbutton');
  await fontSize.fill('42');
  await fontSize.press('Tab');
  await expect.poll(() => readDraft(page)).toContain('"fontSize":42');
  await fontSize.fill('');
  await fontSize.press('Tab');
  await expect.poll(() => readDraft(page)).toContain('"fontSize":24');
  await page.reload();
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await expect(fontSize).toHaveValue('24');
  await expect(page.getByPlaceholder('请输入内容')).toHaveValue('Keep this text');
});

test('missing cached media does not prevent restoring text or overwrite the draft on load', async({ page }) => {
  await dropFile(page);
  await expectImported(page);
  await addText(page, 'Still here');
  await expect.poll(() => readDraft(page)).toContain('Still here');
  const draft = await readDraft(page) ?? '';
  const assetId = JSON.parse(draft).lines.find((line: { type: string }) => line.type === 'video').tracks[0].source.id;
  await page.evaluate(async id => {
    await (await navigator.storage.getDirectory()).removeEntry(id);
  }, assetId);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('草稿中有素材丢失或无法读取');
  await expect(page.locator(tracks)).toHaveCount(0);
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await expect(page.getByPlaceholder('请输入内容')).toHaveValue('Still here');
  expect(await readDraft(page)).toBe(draft);
});

test('an invalid draft leaves a usable editor without overwriting the original', async({ page }) => {
  const invalid = '{"version":42,"lines":[]}';
  await page.evaluate(({ key, draft }) => localStorage.setItem(key, draft), { key: draftKey, draft: invalid });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('无法读取本地草稿');
  await expect(page.locator('.trackItem')).toHaveCount(0);
  expect(await readDraft(page)).toBe(invalid);
  await addText(page, 'Fresh draft');
  await expect.poll(() => readDraft(page)).toContain('Fresh draft');
});

for (const encoder of ['VideoEncoder', 'AudioEncoder']) {
  test(`unsupported ${encoder} clears export loader without opening picker`, async({ page }) => {
    await dropFile(page);
    await expectImported(page);
    await page.evaluate(encoderName => {
      (window as any)[encoderName].isConfigSupported = async(config: unknown) => ({ supported: false, config });
    }, encoder);
    await page.getByRole('button', { name: '合成视频' }).click();
    await expect(page.getByText('当前浏览器不支持 MP4 所需的 H.264 或 AAC 编码，请更换浏览器后重试')).toBeVisible();
    await expectIdle(page, 0);
  });
}

test('video with a text overlay checks the MP4 output encoder settings', async({ page }) => {
  const videoConfigs: unknown[] = [];
  await page.exposeFunction('recordVideoEncoderConfig', (config: unknown) => {
    videoConfigs.push(config);
  });
  await page.evaluate(() => {
    const nativeCheck = window.VideoEncoder.isConfigSupported.bind(window.VideoEncoder);
    window.VideoEncoder.isConfigSupported = async config => {
      await (window as any).recordVideoEncoderConfig(config);
      return nativeCheck(config);
    };
    window.AudioEncoder.isConfigSupported = async config => ({ supported: false, config });
  });

  await dropFile(page);
  await expectImported(page);
  await page.getByText('文字', { exact: true }).click();
  await page.getByText('添加文字', { exact: true }).click();
  await expect(page.locator('.trackLine[data-type="text"]')).toHaveCount(1);

  await page.getByRole('button', { name: '合成视频' }).click();
  await expect(page.getByText('当前浏览器不支持 MP4 所需的 H.264 或 AAC 编码，请更换浏览器后重试')).toBeVisible();
  expect(videoConfigs).toEqual([{
    codec: 'avc1.42E032',
    width: 1080,
    height: 1920,
    bitrate: 5e6
  }]);
  await expectIdle(page, 0);
});

test('encoding recovers after confirm and save-picker cancellation', async({ page }) => {
  await page.evaluate(async() => {
    const NativeEncoder = (window as any).AudioEncoder;
    const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 };
    if ((await NativeEncoder.isConfigSupported(config)).supported) return;
    // Linux Chromium lacks AAC encoding. Keep real H.264 and OPFS, but use
    // native Opus audio for this cancellation-only test (not MP4 validity).
    (window as any).AudioEncoder = class extends NativeEncoder {
      static async isConfigSupported(request: Record<string, unknown>) {
        return { supported: true, config: request };
      }

      configure(request: Record<string, unknown>) {
        super.configure({ ...request, codec: 'opus' });
      }
    };
  });
  await dropFile(page);
  await expectImported(page);
  const exportButton = page.getByRole('button', { name: '合成视频' });
  async function renderAndCancel(action: string, calls: number) {
    await exportButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('视频已合成，是否保存 MP4？')).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.el-loading-mask')).toHaveCount(0);
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expectIdle(page, calls);
  }
  await renderAndCancel('取消', 0);
  await renderAndCancel('保存 MP4', 1);
  await renderAndCancel('取消', 1);
});
