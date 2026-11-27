/* global FileSystemDirectoryHandle, CompressionStream, DecompressionStream */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('e2e/fixtures/sample.mp4');
const tracks = '.tk-track-row:has(.tk-track-clip[data-type="video"])';
const draftKey = 'flycut.editorDraft';
const textClip = '.tk-track-clip[data-type="text"]';

async function projectDir() {
  const root = await navigator.storage.getDirectory();
  const id = localStorage.getItem('flycut.currentProject');
  if (!id) throw new Error('No current project');
  const flycut = await root.getDirectoryHandle('flycut', { create: true });
  const projects = await flycut.getDirectoryHandle('projects', { create: true });
  return projects.getDirectoryHandle(id, { create: true });
}

function readDraft(page: Page): Promise<string | null> {
  return page.evaluate(async source => {
    try {
      // eslint-disable-next-line no-new-func
      const dir = await (new Function(`return (${source})()`)() as Promise<FileSystemDirectoryHandle>);
      const file = await (await dir.getFileHandle('project.json.gz')).getFile();
      return await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } catch {
      return null;
    }
  }, projectDir.toString());
}

async function writeDraft(page: Page, text: string) {
  await page.evaluate(async({ source, text: json }) => {
    // eslint-disable-next-line no-new-func
    const dir = await (new Function(`return (${source})()`)() as Promise<FileSystemDirectoryHandle>);
    const writable = await (await dir.getFileHandle('project.json.gz', { create: true })).createWritable();
    await new Blob([json]).stream()
.pipeThrough(new CompressionStream('gzip'))
.pipeTo(writable);
  }, { source: projectDir.toString(), text });
}

function videoClips(json: string | null) {
  return JSON.parse(json ?? '{}').lines?.find((line: { t: string }) => line.t === 'video')?.c;
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

async function openResources(page: Page) {
  await page.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
}

async function dropRawFile(page: Page, name: string) {
  const bytes = [...readFileSync(path.resolve('e2e/fixtures', name))];
  const dataTransfer = await page.evaluateHandle(({ bytes: fileBytes, name: fileName }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(fileBytes)], fileName, {
      type: fileName.endsWith('.mp4') ? 'video/mp4' : 'text/plain'
    }));
    return transfer;
  }, { bytes, name });
  const timeline = page.locator('.trackList');
  await timeline.dispatchEvent('dragover', { dataTransfer });
  await timeline.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
}

// 文件先导入资源列表，再把资源卡片拖到时间轴
async function addMedia(page: Page, name = 'sample.mp4') {
  await openResources(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser).setFiles(path.resolve('e2e/fixtures', name));
  const card = page.locator(`.media-card[title="${name}"]`);
  await expect(card).toHaveCount(1);
  await expect(page.locator('.media-loading')).toHaveCount(0);
  await card.dragTo(page.locator('.trackList'));
}

async function expectImported(page: Page) {
  await expect(page.locator(tracks)).toHaveCount(1);
  await expect.poll(() => page.locator('#player canvas').first()
    .evaluate((element: HTMLCanvasElement) => {
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

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    (window as any).savePickerCalls = 0;
    (window as any).showSaveFilePicker = async() => {
      (window as any).savePickerCalls++;
      throw new DOMException('User cancelled', 'AbortError');
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '合成视频' })).toBeVisible();
}

test.beforeEach(async({ page }) => openEditor(page));

test('empty project offers media drop and has no tracks', async({ page }) => {
  await expect(page.getByText('从资源列表把视频、图片或音频拖到这里，开始编辑你的大作吧~')).toBeVisible();
  await expect(page.locator('.tk-track-row')).toHaveCount(0);
});

test('dragging an MP4 resource to the timeline creates a video track and renders preview pixels', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
});

async function dragVideo(page: Page, dx: number) {
  const target = page.locator('.move-target[data-kind="video"]');
  await expect(target).toHaveCount(1);
  const before = await target.boundingBox();
  const picture = await target.locator('canvas').boundingBox();
  if (!before || !picture) throw new Error('video element not visible');
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + dx, before.y + before.height / 2, { steps: 8 });
  await page.mouse.up();
  return { target, before, picture };
}

test('preview video is a DOM element that moves with the Moveable drag', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  const { target, before, picture } = await dragVideo(page, 40);
  await expect(page.locator('.cc-move .moveable-control').first()).toBeVisible();
  const after = await target.boundingBox();
  const moved = await target.locator('canvas').boundingBox();
  expect(after!.x - before.x).toBeGreaterThan(30);
  expect(moved!.x - picture.x).toBeCloseTo(after!.x - before.x, 0);
  const centerX = async() => videoClips(await readDraft(page))?.[0]?.x;
  await expect.poll(centerX).toBeGreaterThan(0);
});

async function addFromLibrary(page: Page, count: number) {
  const cards = page.locator('.media-card');
  await expect(cards).toHaveCount(count);
  await expect(page.locator('.media-loading')).toHaveCount(0);
  // 导入只进入素材列表，不直接放到时间轴
  await expect(page.locator('.tk-track-clip')).toHaveCount(0);
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop -- 按顺序添加
    await cards.nth(i).hover();
    // eslint-disable-next-line no-await-in-loop
    await cards.nth(i).locator('.media-add')
.click();
  }
}

test('resource file chooser creates a video track', async({ page }) => {
  await page.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser).setFiles(fixture);
  await addFromLibrary(page, 1);
  await expectImported(page);
});

function wavFile(seconds: number) {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  return buffer;
}

test('one resource chooser imports video, image and audio together', async({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser).setFiles([
    { name: 'sample.mp4', mimeType: 'video/mp4', buffer: readFileSync(fixture) },
    { name: 'dot.png', mimeType: 'image/png', buffer: png },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavFile(1) }
  ]);
  await expect(page.locator('.media-loading')).not.toHaveCount(0);
  await addFromLibrary(page, 3);
  await Promise.all(['video', 'image', 'audio']
    .map(type => expect(page.locator(`.tk-track-clip[data-type="${type}"]`)).toHaveCount(1)));
  await expect(page.locator('.move-target[data-kind="image"]')).toHaveCount(1);
});

test('files dropped on the timeline are not imported and unsupported resources warn', async({ page }) => {
  await dropRawFile(page, 'sample.mp4');
  await expect(page.getByText('请先在左侧“资源”中导入文件，再把资源拖到时间轴', { exact: true })).toBeVisible();
  await expect(page.locator('.tk-track-row')).toHaveCount(0);
  await openResources(page);
  await expect(page.locator('.media-card, .media-loading')).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByText('导入资源', { exact: true }).click();
  await (await chooser).setFiles(path.resolve('e2e/fixtures/not-video.txt'));
  await expect(page.getByText('请导入视频、图片或音频文件', { exact: true })).toBeVisible();
  await expect(page.locator('.media-card')).toHaveCount(0);
  await expect(page.locator('.tk-track-row')).toHaveCount(0);
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
  await addMedia(page);
  await expectImported(page);

  const video = page.locator('.tk-track-clip[data-type="video"]');
  const ruler = page.locator('.tk-ruler-canvas');
  const toolbarActions = page.locator('.trackList').locator('..')
.locator('.float-left > div');
  await ruler.click({ position: { x: 27, y: 10 }});
  await video.click({ position: { x: 12, y: 14 }});
  await toolbarActions.nth(2).click();
  await expect(video).toHaveCount(2);

  await addText(page, 'Draft subtitle');
  await page.locator('.el-slider').getByRole('slider')
.last()
.press('ArrowRight');
  await expect.poll(() => readDraft(page)).toContain('Draft subtitle');
  const saved = JSON.parse(await readDraft(page) ?? '');
  expect(saved.scale).toBe(70);
  expect(saved.at).toBe(6);
  const [head, tail] = videoClips(JSON.stringify(saved));
  expect(head).toMatchObject({ s: 0, e: 6, r: expect.any(Number) });
  expect(tail).toMatchObject({ s: 6, l: 6 });
  // 默认值不写入工程文件，两个片段共用一条素材记录
  expect(head).not.toHaveProperty('l');
  expect(tail).not.toHaveProperty('r');
  expect(saved.assets).toHaveLength(1);
  expect(JSON.stringify(saved)).not.toContain('blob:');

  await page.reload();
  await expect(video).toHaveCount(2);
  await expectImported(page);
  await expect(page.getByText('00:00:00:06', { exact: true })).toBeVisible();
  await expect(page.locator('.el-slider').getByRole('slider')
.last()).toHaveAttribute('aria-valuenow', '70');
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await expect(page.getByPlaceholder('请输入内容')).toHaveValue('Draft subtitle');

  const playControl = page.locator('#player').locator('../..')
.locator('.el-icon > svg:visible');
  await playControl.click();
  await expect(page.locator('html')).toHaveAttribute('data-test-playing-src', /^blob:/);
  await playControl.click();
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await page.getByPlaceholder('请输入内容').fill('Continued after reload');
  await expect.poll(() => readDraft(page)).toContain('Continued after reload');
});

test('muted video does not play its audio in the preview', async({ page }) => {
  await page.evaluate(() => {
    const NativeAudio = window.Audio;
    (window as any).playingCount = 0;
    window.Audio = function(src?: string) {
      const audio = new NativeAudio(src);
      audio.addEventListener('playing', () => (window as any).playingCount++);
      return audio;
    } as typeof Audio;
  });
  await addMedia(page);
  await expectImported(page);
  await page.locator('.move-target[data-kind="video"]').click();
  const mute = page.locator('.formItem', { hasText: '静音' }).locator('.el-switch');
  await mute.click();
  await expect(mute).toHaveClass(/is-checked/);
  const playControl = page.locator('#player').locator('../..')
    .locator('.el-icon > svg:visible');
  await playControl.click();
  // 示例视频只有 0.5 秒，等待播放结束
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).playingCount)).toBe(0);

  await page.locator('.move-target[data-kind="video"]').click();
  await mute.click();
  await expect(mute).not.toHaveClass(/is-checked/);
  await playControl.click();
  await expect.poll(() => page.evaluate(() => (window as any).playingCount)).toBeGreaterThan(0);
});

test('timeline trim updates the source range and undo restores it', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  const video = page.locator('.tk-track-clip[data-type="video"]');
  const offsetL = async() => { const clips = videoClips(await readDraft(page)); return clips ? clips[0].l ?? 0 : undefined; };
  await video.click({ position: { x: 12, y: 14 }});
  const handle = await video.locator('.tk-track-clip-handle').first()
    .boundingBox();
  if (!handle) throw new Error('trim handle not visible');
  const y = handle.y + handle.height / 2;
  await page.mouse.move(handle.x + handle.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(offsetL).toBeGreaterThan(0);

  await page.locator('.trackList').locator('..')
    .locator('.float-left > div')
    .first()
    .click();
  await expect.poll(offsetL).toBe(0);
});

test('deleting the last clip stays deleted after an immediate reload', async({ page }) => {
  await addText(page, 'Do not resurrect');
  await expect.poll(() => readDraft(page)).toContain('Do not resurrect');
  await removeClip(page, textClip);
  await page.reload();
  await expect(page.locator('.tk-track-clip')).toHaveCount(0);
  await expect(page.getByText('从资源列表把视频、图片或音频拖到这里，开始编辑你的大作吧~')).toBeVisible();
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

test('missing cached media preserves the original draft until the timeline changes', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  await addText(page, 'Still here');
  await expect.poll(() => readDraft(page)).toContain('Still here');
  const draft = await readDraft(page) ?? '';
  const assetId = JSON.parse(draft).assets[0].id;
  await page.evaluate(async id => {
    const root = await navigator.storage.getDirectory();
    const assets = await (await root.getDirectoryHandle('flycut')).getDirectoryHandle('assets');
    await assets.removeEntry(id, { recursive: true });
  }, assetId);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('草稿中有素材丢失或无法读取');
  await expect(page.locator(tracks)).toHaveCount(0);
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await expect(page.getByPlaceholder('请输入内容')).toHaveValue('Still here');
  const timelineZoom = page.locator('.el-slider').getByRole('slider')
.last();
  await timelineZoom.press('ArrowRight');
  await expect(timelineZoom).toHaveAttribute('aria-valuenow', '70');
  await page.reload();
  expect(await readDraft(page)).toBe(draft);
  await page.locator(textClip).click({ position: { x: 12, y: 14 }});
  await page.getByPlaceholder('请输入内容').fill('Recovered and edited');
  await expect.poll(() => readDraft(page)).toContain('Recovered and edited');
});

test('an invalid draft leaves a usable editor without overwriting the original', async({ page }) => {
  const invalid = '{"version":42,"lines":[]}';
  await writeDraft(page, invalid);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('无法读取本地草稿');
  await expect(page.locator('.tk-track-clip')).toHaveCount(0);
  expect(await readDraft(page)).toBe(invalid);
  await addText(page, 'Fresh draft');
  await expect.poll(() => readDraft(page)).toContain('Fresh draft');
});

for (const encoder of ['VideoEncoder', 'AudioEncoder']) {
  test(`unsupported ${encoder} clears export loader without opening picker`, async({ page }) => {
    await addMedia(page);
    await expectImported(page);
    await page.evaluate(encoderName => {
      (window as any)[encoderName].isConfigSupported = async(config: unknown) => ({ supported: false, config });
    }, encoder);
    await page.getByRole('button', { name: '合成视频' }).click();
    await expect(page.getByText('当前浏览器不支持 MP4 所需的 H.264 或 Opus 编码，请更换浏览器后重试')).toBeVisible();
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

  await addMedia(page);
  await expectImported(page);
  await page.getByText('文字', { exact: true }).click();
  await page.getByText('添加文字', { exact: true }).click();
  await expect(page.locator('.tk-track-row:has(.tk-track-clip[data-type="text"])')).toHaveCount(1);

  await page.getByRole('button', { name: '合成视频' }).click();
  await expect(page.getByText('当前浏览器不支持 MP4 所需的 H.264 或 Opus 编码，请更换浏览器后重试')).toBeVisible();
  expect(videoConfigs).toEqual([{
    codec: 'avc1.42E032',
    width: 1080,
    height: 1920,
    bitrate: 5e6
  }]);
  await expectIdle(page, 0);
});

async function saveToOpfs(page: Page, filename: string) {
  await page.evaluate(name => {
    (window as any).showSaveFilePicker = async() => {
      (window as any).savePickerCalls++;
      const directory = await navigator.storage.getDirectory();
      return directory.getFileHandle(name, { create: true });
    };
  }, filename);
  await page.getByRole('button', { name: '合成视频' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存 MP4', exact: true }).click();
  await expect(page.getByText('合成视频成功', { exact: true })).toBeVisible();
  await expectIdle(page, 1);
}

async function expectPlayableAudio(page: Page, filename: string) {
  const playback = await page.evaluate(async name => {
    const directory = await navigator.storage.getDirectory();
    const file = await (await directory.getFileHandle(name)).getFile();
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const audio = new AudioContext();
    const source = audio.createMediaElementSource(video);
    const analyser = audio.createAnalyser();
    source.connect(analyser).connect(audio.destination);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const toneBin = Math.round(440 * analyser.fftSize / audio.sampleRate);
    let toneLevel = 0;
    try {
      video.src = url;
      await Promise.all([audio.resume(), video.play()]);
      await new Promise<void>(resolve => {
        const deadline = performance.now() + 5000;
        function sample() {
          analyser.getByteFrequencyData(spectrum);
          toneLevel = Math.max(toneLevel, spectrum[toneBin]);
          if (video.ended || performance.now() >= deadline) resolve();
          else requestAnimationFrame(sample);
        }
        sample();
      });
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        time: video.currentTime,
        ended: video.ended,
        toneLevel
      };
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      await audio.close();
    }
  }, filename);
  expect(playback).toMatchObject({ width: 1080, height: 1920, ended: true });
  expect(playback.time).toBeGreaterThan(0.4);
  expect(playback.toneLevel).toBeGreaterThan(100);
}

test('exported MP4 plays the source audio and can be edited again', async({ page, browser, baseURL }) => {
  await addMedia(page);
  await expectImported(page);
  const name = 'with-audio.mp4';
  await saveToOpfs(page, name);
  await expectPlayableAudio(page, name);

  const bytes = await page.evaluate(async filename => {
    const directory = await navigator.storage.getDirectory();
    const file = await (await directory.getFileHandle(filename)).getFile();
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }, name);
  const reopened = await browser.newPage({ baseURL });
  try {
    await openEditor(reopened);
    await reopened.locator('.tabsToggle').getByText('资源', { exact: true })
    .click();
    const chooser = reopened.waitForEvent('filechooser');
    await reopened.getByText('导入资源', { exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(bytes) });
    await addFromLibrary(reopened, 1);
    await expectImported(reopened);
    await saveToOpfs(reopened, 're-export.mp4');
    await expectPlayableAudio(reopened, 're-export.mp4');
  } finally {
    await reopened.close();
  }
});

test('missing Opus metadata aborts export without opening the save picker', async({ page }) => {
  await page.evaluate(() => {
    const NativeEncoder = (window as any).AudioEncoder;
    (window as any).AudioEncoder = class extends NativeEncoder {
      constructor({ output, error }: { output: (chunk: unknown) => void, error: (error: DOMException) => void }) {
        super({ output: (chunk: unknown) => output(chunk), error });
      }
    };
  });
  await addMedia(page);
  await expectImported(page);
  await page.getByRole('button', { name: '合成视频' }).click();
  await expect(page.getByText('导出视频失败，请重试')).toBeVisible();
  await expectIdle(page, 0);
});

test('encoding recovers after confirm and save-picker cancellation', async({ page }) => {
  await addMedia(page);
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

test('exported MP4 keeps the position the video was dragged to', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  const { before } = await dragVideo(page, 0);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width, before.y + before.height / 2, { steps: 8 });
  await page.mouse.up();
  const handle = page.locator('.cc-move .moveable-control.moveable-ne');
  const corner = await handle.boundingBox();
  const player = await page.locator('#player').boundingBox();
  if (!corner || !player) throw new Error('resize handle not rendered');
  expect(corner.x).toBeGreaterThan(player.x + player.width);
  // 拖出画布的元素其缩放控制点不被画布裁剪
  expect(await handle.evaluate((element, [x, y]) => document.elementFromPoint(x, y) === element,
    [corner.x + corner.width / 2, corner.y + corner.height / 2])).toBe(true);
  const name = 'dragged.mp4';
  await saveToOpfs(page, name);
  const columns = await page.evaluate(async filename => {
    const directory = await navigator.storage.getDirectory();
    const file = await (await directory.getFileHandle(filename)).getFile();
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    try {
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      video.currentTime = 0.2;
      await new Promise(resolve => { video.onseeked = resolve; });
      const canvas = document.createElement('canvas');
      canvas.width = 108;
      canvas.height = 192;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, 108, 192);
      const pixels = ctx.getImageData(0, 0, 108, 192).data;
      const bright = (from: number, to: number) => {
        let max = 0;
        for (let y = 0; y < 192; y++) {
          for (let x = from; x < to; x++) {
            const i = (y * 108 + x) * 4;
            max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
          }
        }
        return max;
      };
      return { left: bright(0, 40), right: bright(68, 108) };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }, name);
  expect(columns.left).toBeLessThan(30);
  expect(columns.right).toBeGreaterThan(50);
});

const videoClip = '.tk-track-clip[data-type="video"]';

function opfsEntries(page: Page, ...dirs: string[]) {
  return page.evaluate(async segments => {
    let dir = await navigator.storage.getDirectory();
    try {
      // eslint-disable-next-line no-await-in-loop -- 逐级打开目录
      for (const name of segments) dir = await dir.getDirectoryHandle(name);
    } catch {
      return [];
    }
    const names: string[] = [];
    for await (const name of (dir as any).keys()) names.push(name);
    return names.sort();
  }, dirs);
}

test('resource library persists imported media and reuses it after a reload', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  await openResources(page);
  await expect(page.locator('.media-card')).toHaveCount(1);
  await expect.poll(() => readDraft(page)).toContain('"v":2');

  await page.reload();
  await expect(page.locator(videoClip)).toHaveCount(1);
  await openResources(page);
  const card = page.locator('.media-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toBeVisible();
  await card.hover();
  await card.locator('.media-add').click();
  await expect(page.locator(videoClip)).toHaveCount(2);

  await addMedia(page);
  await expect(page.locator(videoClip)).toHaveCount(3);
  await expect(card).toHaveCount(1);
  await expect.poll(async() => JSON.parse(await readDraft(page) ?? '{}').lines
    ?.flatMap((line: { c: unknown[] }) => line.c).length).toBe(3);
  const saved = JSON.parse(await readDraft(page) ?? '{}');
  expect(saved.assets).toHaveLength(1);
  expect(await opfsEntries(page, 'flycut', 'assets')).toEqual([saved.assets[0].id]);
});

test('a legacy localStorage draft and root-level OPFS media migrate into a project', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  await expect.poll(() => readDraft(page)).toContain('"v":2');
  const { id, n: name, f: format, d: duration, w: width, h: height } = JSON.parse(await readDraft(page) ?? '{}').assets[0];
  const legacy = {
    version: 1,
    trackScale: 30,
    playhead: 0,
    lines: [{
      type: 'video',
      main: true,
      tracks: [{
        type: 'video', start: 0, end: 30, frameCount: 30,
        source: { id, name, format, duration, width, height },
        trim: { offsetL: 0, offsetR: 0 },
        placement: { centerX: 0, centerY: 0, scale: 100, width: 200, height: 120 }
      }]
    }]
  };
  await page.evaluate(async({ asset, key, draft }) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await (await (await (await root.getDirectoryHandle('flycut')).getDirectoryHandle('assets'))
      .getDirectoryHandle(asset)).getFileHandle('data')).getFile();
    const writable = await (await root.getFileHandle(asset, { create: true })).createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    await root.removeEntry('flycut', { recursive: true });
    localStorage.clear();
    localStorage.setItem(key, draft);
  }, { asset: id, key: draftKey, draft: JSON.stringify(legacy) });

  await page.reload();
  await expect(page.locator(videoClip)).toHaveCount(1);
  await expect.poll(() => readDraft(page)).toContain('"v":2');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
  expect(await opfsEntries(page)).toEqual(['flycut']);
  expect(await opfsEntries(page, 'flycut', 'assets', id)).toEqual(expect.arrayContaining(['data', 'meta.json']));
  expect(JSON.parse(await readDraft(page) ?? '{}').scale).toBe(30);
});

test('a .flycut package restores the project and its media in a fresh browser', async({ page, browser, baseURL }, testInfo) => {
  await addMedia(page);
  await expectImported(page);
  await addText(page, 'Packed caption');
  await expect.poll(() => readDraft(page)).toContain('Packed caption');
  await page.locator('.project-menu').click();
  const download = page.waitForEvent('download');
  await page.getByText('导出工程（.flycut）').click();
  const file = testInfo.outputPath('project.flycut');
  await (await download).saveAs(file);

  const fresh = await browser.newContext({ baseURL });
  try {
    const other = await fresh.newPage();
    await openEditor(other);
    await expect(other.locator('.tk-track-clip')).toHaveCount(0);
    await other.locator('.project-menu').click();
    const chooser = other.waitForEvent('filechooser');
    await other.getByText('导入工程（.flycut）').click();
    await (await chooser).setFiles(file);
    await expect(other.locator(videoClip)).toHaveCount(1);
    await expect(other.locator(textClip)).toHaveCount(1);
    await expect(other.locator('.project-name')).toHaveText('未命名工程');
    await openResources(other);
    await expect(other.locator('.media-card')).toHaveCount(1);
    await expect.poll(() => readDraft(other)).toContain('Packed caption');
  } finally {
    await fresh.close();
  }
});

test('projects can be created and switched, and cleanup keeps assets used by any project', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  await expect.poll(() => readDraft(page)).toContain('"v":2');
  await page.locator('.project-menu').click();
  await page.getByText('新建工程').click();
  await expect(page.locator('.tk-track-clip')).toHaveCount(0);

  await openResources(page);
  await page.getByText('清理未使用素材').click();
  await expect(page.getByText('没有未使用的素材')).toBeVisible();

  await page.locator('.project-menu').click();
  await page.getByText('删除当前工程').click();
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator(videoClip)).toHaveCount(1);
  await removeClip(page, videoClip);
  await expect(page.locator(videoClip)).toHaveCount(0);
  await expect.poll(async() => JSON.parse(await readDraft(page) ?? '{}').assets?.length).toBe(0);
  // 撤销记录仍引用素材，不能清理
  await openResources(page);
  await page.getByText('清理未使用素材').click();
  await expect(page.getByText('没有未使用的素材')).toBeVisible();

  await page.reload();
  await openResources(page);
  await page.getByText('清理未使用素材').click();
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.media-card')).toHaveCount(0);
  expect(await opfsEntries(page, 'flycut', 'assets')).toEqual([]);
});

async function exportedBrightness(page: Page, filename: string, times: number[]) {
  return page.evaluate(async([name, seconds]) => {
    const directory = await navigator.storage.getDirectory();
    const file = await (await directory.getFileHandle(name as string)).getFile();
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    try {
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 108;
      canvas.height = 192;
      const ctx = canvas.getContext('2d')!;
      const result: number[] = [];
      for (const time of seconds as number[]) {
        video.currentTime = time;
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => { video.onseeked = resolve; });
        ctx.drawImage(video, 0, 0, 108, 192);
        const pixels = ctx.getImageData(0, 0, 108, 192).data;
        let max = 0;
        for (let i = 0; i < pixels.length; i += 4) max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
        result.push(max);
      }
      return result;
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }, [filename, times] as const);
}

test('a fade-in animation shows in the DOM preview, persists and is drawn into the exported MP4', async({ page }) => {
  await addMedia(page);
  await expectImported(page);
  await page.locator('.tk-track-clip[data-type="video"]').click({ position: { x: 12, y: 14 }});
  await page.getByRole('tab', { name: '动画' }).click();
  await page.locator('.el-collapse-item__header', { hasText: '入场' }).click();
  const entrance = page.locator('.el-collapse-item', { hasText: '入场' });
  await entrance.locator('.el-select').first()
    .click();
  await page.locator('.el-select-dropdown__item:visible', { hasText: '淡入' }).click();

  const picture = page.locator('.move-target[data-kind="video"] canvas');
  await expect(picture).toHaveCSS('opacity', '0');
  await page.locator('.tk-ruler-canvas').click({ position: { x: 27, y: 10 }});
  await expect.poll(async() => Number(await picture.evaluate(element => getComputedStyle(element).opacity)))
    .toBeGreaterThan(0);
  await expect.poll(async() => videoClips(await readDraft(page))?.[0]?.an).toEqual({ i: ['fade'] });

  const name = 'faded.mp4';
  await saveToOpfs(page, name);
  const [start, end] = await exportedBrightness(page, name, [0.01, 0.45]);
  expect(start).toBeLessThan(20);
  expect(end).toBeGreaterThan(50);
});
