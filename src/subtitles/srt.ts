export interface SubtitleSegment {
  /** 时间轴上的开始时间（秒） */
  start: number;
  end: number;
  text: string;
}

function stamp(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function formatSrt(segments: SubtitleSegment[]) {
  return segments.map(({ start, end, text }, index) => `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}\n`).join('\n');
}

const timing = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function toSeconds(h: string, m: string, s: string, ms: string) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** 解析 SRT（也兼容 WebVTT 的点号毫秒），忽略序号和无效块 */
export function parseSrt(content: string): SubtitleSegment[] {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .flatMap(block => {
      const lines = block.split('\n');
      const index = lines.findIndex(line => timing.test(line));
      if (index === -1) return [];
      const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = lines[index].match(timing) as RegExpMatchArray;
      const text = lines.slice(index + 1).join('\n')
        .trim();
      const start = toSeconds(h1, m1, s1, ms1);
      const end = toSeconds(h2, m2, s2, ms2);
      return text && end > start ? [{ start, end, text }] : [];
    });
}
