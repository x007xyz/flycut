import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('e2e/fixtures/sample.mp4');
const tracks = '.trackLine[data-type="video"]';

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
