import { createTimeline } from 'animejs';

export type AnimationKind = 'in' | 'out' | 'loop';
export interface AnimationSpec {
  preset: string,
  duration: number,
  // 空字符串表示使用预设的默认缓动
  ease: string
}
export type ClipAnimations = Record<AnimationKind, AnimationSpec>;

// x、y 为画面宽高的比例（场景中换算为像素），rotate 为角度，blur 为像素，reveal 为文字显示比例
export interface Motion {
  x: number,
  y: number,
  scale: number,
  rotate: number,
  opacity: number,
  blur: number,
  reveal: number
}

const rest: Motion = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, blur: 0, reveal: 1 };

// 入场从这些值过渡到静止状态，出场从静止状态过渡到这些值
const offsets: Record<string, Partial<Motion>> = {
  fade: { opacity: 0 },
  left: { x: -0.3, opacity: 0 },
  right: { x: 0.3, opacity: 0 },
  top: { y: -0.3, opacity: 0 },
  bottom: { y: 0.3, opacity: 0 },
  'zoom-in': { scale: 0.5, opacity: 0 },
  'zoom-out': { scale: 1.5, opacity: 0 },
  pop: { scale: 0 },
  blur: { blur: 12, opacity: 0 },
  rotate: { rotate: -90, scale: 0.5, opacity: 0 },
  typewriter: { reveal: 0 }
};

// 循环动画每个周期从静止状态到峰值再回到静止状态；spin 每周期转一圈
const peaks: Record<string, Partial<Motion>> = {
  pulse: { scale: 1.08 },
  float: { y: -0.03 },
  shake: { x: 0.015 },
  flicker: { opacity: 0.4 },
  spin: { rotate: 360 }
};

export const animationPresets: Record<AnimationKind, { value: string, label: string }[]> = {
  in: [
    { value: 'none', label: '无' },
    { value: 'fade', label: '淡入' },
    { value: 'left', label: '从左滑入' },
    { value: 'right', label: '从右滑入' },
    { value: 'top', label: '从上滑入' },
    { value: 'bottom', label: '从下滑入' },
    { value: 'zoom-in', label: '放大进入' },
    { value: 'zoom-out', label: '缩小进入' },
    { value: 'pop', label: '弹出' },
    { value: 'blur', label: '模糊进入' },
    { value: 'rotate', label: '旋转进入' },
    { value: 'typewriter', label: '逐字出现（文字）' }
  ],
  out: [
    { value: 'none', label: '无' },
    { value: 'fade', label: '淡出' },
    { value: 'left', label: '向左滑出' },
    { value: 'right', label: '向右滑出' },
    { value: 'top', label: '向上滑出' },
    { value: 'bottom', label: '向下滑出' },
    { value: 'zoom-in', label: '缩小消失' },
    { value: 'zoom-out', label: '放大消失' },
    { value: 'pop', label: '收起' },
    { value: 'blur', label: '模糊消失' },
    { value: 'rotate', label: '旋转消失' },
    { value: 'typewriter', label: '逐字消失（文字）' }
  ],
  loop: [
    { value: 'none', label: '无' },
    { value: 'pulse', label: '呼吸' },
    { value: 'float', label: '浮动' },
    { value: 'shake', label: '摇摆' },
    { value: 'flicker', label: '闪烁' },
    { value: 'spin', label: '旋转' }
  ]
};

export const animationEases = [
  { value: '', label: '默认' },
  { value: 'linear', label: '匀速' },
  { value: 'outQuad', label: '减速' },
  { value: 'inQuad', label: '加速' },
  { value: 'inOutQuad', label: '先加速后减速' },
  { value: 'outBack', label: '回弹' },
  { value: 'outElastic', label: '弹性' },
  { value: 'outBounce', label: '弹跳' }
];

const kinds: AnimationKind[] = ['in', 'out', 'loop'];
export const defaultDurations: Record<AnimationKind, number> = { in: 0.5, out: 0.5, loop: 1 };

export function defaultAnimations(): ClipAnimations {
  return {
    in: { preset: 'none', duration: defaultDurations.in, ease: '' },
    out: { preset: 'none', duration: defaultDurations.out, ease: '' },
    loop: { preset: 'none', duration: defaultDurations.loop, ease: '' }
  };
}

export function isPreset(kind: AnimationKind, preset: unknown) {
  return animationPresets[kind].some(({ value }) => value === preset);
}

export function isEase(ease: unknown) {
  return animationEases.some(({ value }) => value === ease);
}

function active(spec: AnimationSpec | undefined, kind: AnimationKind) {
  return spec && spec.preset !== 'none' && isPreset(kind, spec.preset) && spec.duration > 0 ? spec : undefined;
}

/** 只保留已设置的动画，没有动画时返回 undefined */
export function activeAnimations(animations: Partial<ClipAnimations> | undefined) {
  const result: Partial<ClipAnimations> = {};
  kinds.forEach(kind => {
    const spec = active(animations?.[kind], kind);
    if (spec) result[kind] = { ...spec };
  });
  return Object.keys(result).length ? result : undefined;
}

export function withDefaults(animations: Partial<ClipAnimations> | undefined): ClipAnimations {
  return Object.assign(defaultAnimations(), activeAnimations(animations));
}

type Packed = Partial<Record<'i' | 'o' | 'l', [string, number?, string?]>>;
const packKeys = { in: 'i', out: 'o', loop: 'l' } as const;

/** 工程文件里的紧凑格式：{ i: [预设, 时长?, 缓动?] }，默认值不写 */
export function packAnimations(animations: Partial<ClipAnimations> | undefined): Packed | undefined {
  const list = activeAnimations(animations);
  if (!list) return undefined;
  const packed: Packed = {};
  kinds.forEach(kind => {
    const spec = list[kind];
    if (!spec) return;
    const entry: [string, number?, string?] = [spec.preset];
    if (spec.ease) entry.push(spec.duration, spec.ease);
    else if (spec.duration !== defaultDurations[kind]) entry.push(spec.duration);
    packed[packKeys[kind]] = entry;
  });
  return packed;
}

export function unpackAnimations(packed: unknown): Partial<ClipAnimations> | undefined {
  if (typeof packed !== 'object' || packed === null) return undefined;
  const result: Partial<ClipAnimations> = {};
  kinds.forEach(kind => {
    const entry = (packed as Record<string, unknown>)[packKeys[kind]];
    if (!Array.isArray(entry)) return;
    const [preset, duration = defaultDurations[kind], ease = ''] = entry as unknown[];
    result[kind] = { preset, duration, ease } as AnimationSpec;
  });
  return result;
}

export function validAnimations(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([kind, spec]) => kinds.includes(kind as AnimationKind)
    && typeof spec === 'object' && spec !== null
    && isPreset(kind as AnimationKind, spec.preset) && Number.isFinite(spec.duration) && spec.duration > 0
    && isEase(spec.ease));
}

type Step = { from: Partial<Motion>, to: Partial<Motion>, duration: number, ease: string };

// 每次求值都新建一个暂停的 anime.js 时间轴并 seek 到目标时间，结果只取决于时间，预览和导出一致
function seek(steps: Step[], time: number) {
  const state = { ...rest };
  const timeline = createTimeline({ autoplay: false, defaults: { composition: 'none' }});
  let at = 0;
  steps.forEach(({ from, to, duration, ease }) => {
    const params: Record<string, unknown> = { duration: Math.max(1, duration * 1000), ease };
    (Object.keys({ ...from, ...to }) as (keyof Motion)[]).forEach(key => {
      params[key] = [from[key] ?? rest[key], to[key] ?? rest[key]];
    });
    timeline.add(state, params, at);
    at += duration * 1000;
  });
  timeline.seek(time * 1000);
  return state;
}

/** 片段内 time 秒处的动画状态；total 为片段时长；没有动画时返回 null */
export function motionAt(animations: Partial<ClipAnimations> | undefined, time: number, total: number): Motion | null {
  const enter = active(animations?.in, 'in');
  const exit = active(animations?.out, 'out');
  const loop = active(animations?.loop, 'loop');
  if (!enter && !exit && !loop) return null;
  let inDuration = enter?.duration ?? 0;
  let outDuration = exit?.duration ?? 0;
  // 入场和出场加起来超过片段时长时按比例缩短
  const fit = Math.min(1, total / (inDuration + outDuration || 1));
  inDuration *= fit;
  outDuration *= fit;
  const outStart = total - outDuration;
  const t = Math.min(Math.max(time, 0), total);
  let state = { ...rest };
  if (enter && t < inDuration) {
    state = seek([{ from: offsets[enter.preset], to: {}, duration: inDuration, ease: enter.ease || (enter.preset === 'pop' ? 'outBack' : 'outCubic') }], t);
  } else if (exit && t >= outStart) {
    state = seek([{ from: {}, to: offsets[exit.preset], duration: outDuration, ease: exit.ease || (exit.preset === 'pop' ? 'inBack' : 'inCubic') }], t - outStart);
  } else if (loop) {
    const local = (t - inDuration) % loop.duration;
    const peak = peaks[loop.preset];
    state = loop.preset === 'spin'
      ? seek([{ from: {}, to: peak, duration: loop.duration, ease: loop.ease || 'linear' }], local)
      : seek([
        { from: {}, to: peak, duration: loop.duration / 2, ease: loop.ease || 'inOutSine' },
        { from: peak, to: {}, duration: loop.duration / 2, ease: loop.ease || 'inOutSine' }
      ], local);
  }
  state.opacity = Math.min(1, Math.max(0, state.opacity));
  state.reveal = Math.min(1, Math.max(0, state.reveal));
  state.scale = Math.max(0, state.scale);
  state.blur = Math.max(0, state.blur);
  return state;
}
