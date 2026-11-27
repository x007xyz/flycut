export interface SpeechWindow {
  start: number;
  end: number;
}

const frameSeconds = 0.02;
const maxWindow = 28;
const minGap = 0.4;
const padding = 0.2;

function quietestPoint(levels: Float32Array, from: number, to: number) {
  let cut = to;
  let quietest = Infinity;
  for (let index = Math.ceil(from / frameSeconds); index < to / frameSeconds; index++) {
    if (levels[index] < quietest) {
      quietest = levels[index];
      cut = index * frameSeconds;
    }
  }
  return cut;
}

/**
 * 按音量把音频切成不超过 28 秒的语音窗口，窗口边界落在静音处。
 * transformers.js 对超过 30 秒的音频分块合并时间戳不可靠，所以逐窗识别再加上窗口起点。
 */
export function speechWindows(audio: Float32Array, rate: number): SpeechWindow[] {
  const frame = Math.max(1, Math.round(rate * frameSeconds));
  const levels = new Float32Array(Math.ceil(audio.length / frame));
  for (let index = 0; index < levels.length; index++) {
    let sum = 0;
    const end = Math.min(audio.length, (index + 1) * frame);
    for (let sample = index * frame; sample < end; sample++) sum += audio[sample] * audio[sample];
    levels[index] = Math.sqrt(sum / (end - index * frame));
  }
  const sorted = Float32Array.from(levels).sort();
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = Math.max(0.005, loud * 0.08);

  const regions: SpeechWindow[] = [];
  levels.forEach((level, index) => {
    if (level < threshold) return;
    const start = index * frameSeconds;
    const last = regions[regions.length - 1];
    if (last && start - last.end <= minGap) last.end = start + frameSeconds;
    else regions.push({ start, end: start + frameSeconds });
  });

  const duration = audio.length / rate;
  const windows: SpeechWindow[] = [];
  for (const region of regions) {
    const end = Math.min(duration, region.end + padding);
    const last = windows[windows.length - 1];
    if (last && end - last.start <= maxWindow) {
      last.end = end;
    } else {
      let start = Math.max(last?.end ?? 0, region.start - padding);
      // 连续语音超过窗口长度时，在 20~28 秒内最安静的地方切开
      while (end - start > maxWindow) {
        const cut = quietestPoint(levels, start + 20, start + maxWindow);
        windows.push({ start, end: cut });
        start = cut;
      }
      windows.push({ start, end });
    }
  }
  return windows;
}
