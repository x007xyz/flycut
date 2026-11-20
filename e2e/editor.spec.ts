import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('e2e/fixtures/sample.mp4');
const tracks = '.trackLine[data-type="video"]';
const silentNotice = '当前浏览器不支持 AAC 编码，导出的视频将没有声音。';

async function disableAac(page: Page) {
  await page.evaluate(() => {
    window.AudioEncoder.isConfigSupported = async config => ({ supported: false, config });
  });
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

test('unsupported H.264 clears export loader without opening picker', async({ page }) => {
  await dropFile(page);
  await expectImported(page);
  await page.evaluate(() => {
    window.VideoEncoder.isConfigSupported = async config => ({ supported: false, config });
  });
  await page.getByRole('button', { name: '合成视频' }).click();
  await expect(page.getByText('当前浏览器不支持 MP4 所需的 H.264 编码，请更换浏览器后重试')).toBeVisible();
  await expectIdle(page, 0);
});

test('unsupported AAC saves a playable MP4 with no audio track', async({ page }) => {
  await disableAac(page);
  await page.evaluate(() => {
    (window as any).showSaveFilePicker = async() => {
      (window as any).savePickerCalls++;
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle('silent-output.mp4', { create: true });
    };
  });
  await dropFile(page);
  await expectImported(page);
  await page.getByRole('button', { name: '合成视频' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(silentNotice, { exact: false })).toBeVisible({ timeout: 90000 });
  await dialog.getByRole('button', { name: '保存 MP4', exact: true }).click();
  await expect(page.getByText('合成视频成功')).toBeVisible();
  await expectIdle(page, 1);

  const media = await page.evaluate(async() => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle('silent-output.mp4')).getFile();
    const url = URL.createObjectURL(file);
    const video = document.createElement('video') as HTMLVideoElement & { captureStream(): MediaStream };
    video.muted = true;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(video.error?.message ?? 'Export could not be decoded'));
        video.src = url;
      });
      const stream = video.captureStream();
      await video.play();
      return {
        width: video.videoWidth, height: video.videoHeight, duration: video.duration,
        videoTracks: stream.getVideoTracks().length, audioTracks: stream.getAudioTracks().length
      };
    } finally {
      video.pause();
      URL.revokeObjectURL(url);
    }
  });
  expect(media).toMatchObject({ width: 1080, height: 1920, videoTracks: 1, audioTracks: 0 });
  expect(media.duration).toBeGreaterThan(0);
});

test('silent export recovers after confirm and save-picker cancellation', async({ page }) => {
  await disableAac(page);
  await dropFile(page);
  await expectImported(page);
  const exportButton = page.getByRole('button', { name: '合成视频' });
  async function renderAndCancel(action: string, calls: number) {
    await exportButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(silentNotice, { exact: false })).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.el-loading-mask')).toHaveCount(0);
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expectIdle(page, calls);
  }
  await renderAndCancel('取消', 0);
  await renderAndCancel('保存 MP4', 1);
  await renderAndCancel('取消', 1);
});
