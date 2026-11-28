/* eslint-disable camelcase -- 剪映草稿的字段名 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import { AudioTrack } from '@/class/AudioTrack';
import { ImageTrack } from '@/class/ImageTrack';
import { TextTrack } from '@/class/TextTrack';
import { VideoTrack } from '@/class/VideoTrack';
import { baseFps } from '@/data/trackConfig';
import { active, animationPresets, type AnimationKind } from '@/render/animation';
import type { Size, Track } from '@/render/scene';
import { assetStore } from '@/storage/assets';
import { jianyingAnimations } from './animations';
import contentTemplate from './draftContent.json';
import metaTemplate from './draftMeta.json';

// 剪映草稿结构参考 pyJianYingDraft（Apache-2.0）的模板，剪映 5.9 及新版均可读取明文草稿

type Json = Record<string, unknown>;

export interface JianyingOptions {
  name: string;
  /** 剪映草稿目录（本机绝对路径），素材路径据此写成绝对路径；不填时写相对路径，需要在剪映中重新链接 */
  draftRoot?: string;
  /** 预览画布尺寸，flycut 的位置和字号都以它为单位 */
  player: Size;
  /** 导出画布尺寸 */
  canvas: Size;
}

const us = (frames: number) => Math.round(frames * 1e6 / baseFps);
const uuid = () => crypto.randomUUID().toUpperCase();
const round = (value: number) => Math.round(value * 1e4) / 1e4;
// flycut 默认 24px（180px 宽画布）对应剪映默认字号 8，按画布宽度等比换算，是近似值
const jianyingTextSize = (px: number, player: Size) => round(px / player.width * 60);

export function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '') || 'flycut';
}

let colorContext: OffscreenCanvasRenderingContext2D | undefined;

/** 借助 Canvas 把任意 CSS 颜色规范成 #rrggbb 或 rgba()，再转成剪映的 0-1 RGB */
function color(value: string | undefined, fallback: number[]) {
  if (!value) return fallback;
  colorContext ??= new OffscreenCanvas(1, 1).getContext('2d') as OffscreenCanvasRenderingContext2D;
  // 无效颜色不会改变 fillStyle：从两个不同的初值出发结果不一致时说明颜色无效
  colorContext.fillStyle = '#000000';
  colorContext.fillStyle = value;
  const normalized = String(colorContext.fillStyle);
  colorContext.fillStyle = '#ffffff';
  colorContext.fillStyle = value;
  if (String(colorContext.fillStyle) !== normalized) return fallback;
  const hex = normalized.match(/^#([\da-f]{6})$/i)?.[1];
  const channels = hex ? [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)) : normalized.match(/[\d.]+/g)?.slice(0, 3)
.map(Number);
  return channels?.length === 3 ? channels.map(channel => round(channel / 255)) : fallback;
}

function baseSegment(materialId: string, track: Track, speedId: string, renderIndex: number): Json {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    render_index: renderIndex,
    visible: true,
    id: uuid(),
    material_id: materialId,
    target_timerange: { start: us(track.start), duration: us(track.end) - us(track.start) },
    common_keyframes: [],
    keyframe_refs: [],
    speed: 1,
    volume: 1,
    extra_material_refs: [speedId],
    is_tone_modify: false
  };
}

/** 片段时长不超过素材剩余时长：帧数取整后可能比素材略长 */
function timing(track: Track, sourceStart: number, sourceDuration?: number) {
  const start = us(track.start);
  let duration = us(track.end) - start;
  if (sourceDuration !== undefined) duration = Math.max(0, Math.min(duration, Math.round(sourceDuration * 1e6) - us(sourceStart)));
  return { target_timerange: { start, duration }, source_timerange: { start: us(sourceStart), duration }};
}

/** flycut 以画布中心为原点、向下为正；剪映以半个画布为单位、向上为正 */
function clip(track: VideoTrack | ImageTrack | TextTrack, scale: number, player: Size) {
  return {
    alpha: 1,
    flip: { horizontal: false, vertical: false },
    rotation: 0,
    scale: { x: round(scale), y: round(scale) },
    transform: { x: round(track.centerX / (player.width / 2)), y: round(-track.centerY / (player.height / 2)) }
  };
}

/** 生成剪映草稿文件夹的 zip：draft_content.json、draft_meta_info.json 和 materials/ 下的素材；skipped 是剪映没有对应效果、未导出的动画，animated 是已导出的动画数 */
export async function buildJianyingDraft(lines: { list: Track[] }[], { name, draftRoot, player, canvas }: JianyingOptions) {
  const folder = safeName(name);
  const root = draftRoot?.trim().replace(/[\\/]+$/, '');
  const files: Zippable = {};
  const materials = { videos: [] as Json[], audios: [] as Json[], texts: [] as Json[], speeds: [] as Json[], material_animations: [] as Json[] };
  const skipped = new Set<string>();
  let animated = 0;

  /** 把 flycut 动画换成剪映内置的相近动画；没有对应动画的记下来提示用户 */
  function animate(segment: Json, track: VideoTrack | ImageTrack | TextTrack) {
    const target = track instanceof TextTrack ? 'text' : 'video';
    const total = (segment.target_timerange as { duration: number }).duration;
    const specs = { in: active(track.animations?.in, 'in'), out: active(track.animations?.out, 'out'), loop: active(track.animations?.loop, 'loop') };
    // 与 motionAt 一致：入场和出场（无论剪映有没有对应动画）超出片段时长时按比例缩短，循环在两者之间
    const inDuration = Math.round((specs.in?.duration ?? 0) * 1e6);
    const outDuration = Math.round((specs.out?.duration ?? 0) * 1e6);
    const ratio = Math.min(1, total / (inDuration + outDuration || 1));
    const ranges = {
      in: { start: 0, duration: Math.round(inDuration * ratio) },
      out: { start: total - Math.round(outDuration * ratio), duration: Math.round(outDuration * ratio) },
      loop: { start: Math.round(inDuration * ratio), duration: total - Math.round(inDuration * ratio) - Math.round(outDuration * ratio) }
    };
    const animations: Json[] = [];
    for (const kind of ['in', 'out', 'loop'] as AnimationKind[]) {
      const spec = specs[kind];
      const meta = spec && jianyingAnimations[target][kind]?.[spec.preset];
      const range = ranges[kind];
      if (meta && range.duration > 0) {
        const [title, resourceId, effectId] = meta;
        animations.push({
          anim_adjust_params: null, platform: 'all',
          panel: target === 'video' ? 'video' : '', material_type: target === 'video' ? 'video' : 'sticker',
          name: title, id: effectId, type: kind, resource_id: resourceId, ...range
        });
      } else if (spec) {
        const label = animationPresets[kind].find(({ value }) => value === spec.preset)?.label ?? spec.preset;
        // 剪映的循环动画只在入场和出场之间播放，两者占满片段时无法保留
        const reason = meta ? '（入场和出场占满了片段）' : '';
        skipped.add(`${target === 'text' ? '文字' : '画面'}${kind === 'loop' ? '循环' : ''}「${label}」${reason}`);
      }
    }
    if (!animations.length) return segment;
    animated += animations.length;
    const id = uuid();
    materials.material_animations.push({ id, type: 'sticker_animation', multi_language_current: 'none', animations });
    (segment.extra_material_refs as string[]).push(id);
    return segment;
  }
  const media = new Map<string, string>();
  const tracks: Json[] = [];

  async function mediaMaterial(track: VideoTrack | ImageTrack | AudioTrack) {
    const known = media.get(track.source.id);
    if (known) return known;
    const file = await assetStore.file(track.source.id);
    if (!file) throw new Error(`素材 ${track.source.name} 不存在`);
    const fileName = `${track.source.id.slice(0, 8)}_${safeName(track.source.name)}`;
    files[`${folder}/materials/${fileName}`] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }];
    const path = root ? `${root}/${folder}/materials/${fileName}` : `materials/${fileName}`;
    const id = uuid();
    if (track instanceof AudioTrack) {
      materials.audios.push({
        app_id: 0, category_id: '', category_name: 'local', check_flag: 3, copyright_limit_type: 'none',
        duration: Math.round(track.source.duration * 1e6), effect_id: '', formula_id: '',
        id, local_material_id: id, music_id: id, name: track.source.name, path,
        source_platform: 0, type: 'extract_music', wave_points: []
      });
    } else {
      materials.videos.push({
        audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487,
        crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
        crop_ratio: 'free', crop_scale: 1,
        // 图片在剪映中按 3 小时时长的素材处理
        duration: track instanceof VideoTrack ? Math.round(track.source.duration * 1e6) : 10800000000,
        height: track.source.height, width: track.source.width,
        id, local_material_id: '', material_id: id, material_name: track.source.name,
        media_path: '', path, type: track instanceof VideoTrack ? 'video' : 'photo'
      });
    }
    media.set(track.source.id, id);
    return id;
  }

  function textMaterial(track: TextTrack) {
    const id = uuid();
    const style: Json = {
      fill: { alpha: 1, content: { render_type: 'solid', solid: { alpha: 1, color: color(track.fill, [1, 1, 1]) }}},
      range: [0, track.content.length],
      size: jianyingTextSize(track.fontSize * track.scale / 100, player),
      bold: false,
      italic: false,
      underline: false,
      strokes: track.stroke ? [{ content: { solid: { alpha: 1, color: color(track.stroke, [0, 0, 0]) }}, width: 0.08 }] : []
    };
    const background = track.textBackgroundColor ? {
      background_style: 1, background_color: `#${color(track.textBackgroundColor, [0, 0, 0]).map(c => Math.round(c * 255).toString(16)
.padStart(2, '0'))
.join('')}`,
      background_alpha: 1, background_round_radius: 0, background_height: 0.14, background_width: 0.14,
      background_horizontal_offset: 0, background_vertical_offset: 0
    } : {};
    materials.texts.push({
      id, content: JSON.stringify({ styles: [style], text: track.content }),
      typesetting: 0, alignment: 1, letter_spacing: 0, line_spacing: 0.02, line_feed: 1, line_max_width: 0.82,
      force_apply_line_max_width: false, check_flag: 7 | (track.stroke ? 8 : 0) | (track.textBackgroundColor ? 16 : 0),
      type: 'text', global_alpha: 1, ...background
    });
    return id;
  }

  // flycut 越靠前的轨道层级越高，剪映则是越靠后的轨道越在上层
  for (const line of lines.filter(({ list }) => list.length).reverse()) {
    const renderIndex = tracks.length;
    const segments: Json[] = [];
    let type = 'video';
    for (const track of [...line.list].sort((a, b) => a.start - b.start)) {
      const speedId = uuid();
      materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1, type: 'speed' });
      if (track instanceof TextTrack) {
        type = 'text';
        segments.push(animate({ ...baseSegment(textMaterial(track), track, speedId, renderIndex), source_timerange: null, clip: clip(track, 1, player), uniform_scale: { on: true, value: 1 }}, track));
      } else if (track instanceof AudioTrack) {
        type = 'audio';
        segments.push({
          // eslint-disable-next-line no-await-in-loop -- 素材按顺序写入 zip
          ...baseSegment(await mediaMaterial(track), track, speedId, renderIndex),
          ...timing(track, track.offsetL, track.source.duration),
          volume: track.silent ? 0 : 1, clip: null, hdr_settings: null
        });
      } else if (track instanceof VideoTrack || track instanceof ImageTrack) {
        // 剪映缩放 1 表示素材完整放进画布
        const fit = Math.min(player.width / track.source.width, player.height / track.source.height) * track.source.width;
        segments.push(animate({
          // eslint-disable-next-line no-await-in-loop -- 素材按顺序写入 zip
          ...baseSegment(await mediaMaterial(track), track, speedId, renderIndex),
          ...(track instanceof VideoTrack ? timing(track, track.offsetL, track.source.duration) : timing(track, 0)),
          volume: track instanceof VideoTrack && !track.silent ? 1 : 0,
          clip: clip(track, track.drawWidth / fit, player),
          uniform_scale: { on: true, value: 1 },
          hdr_settings: { intensity: 1, mode: 1, nits: 1000 }
        }, track));
      }
    }
    tracks.push({ attribute: 0, flag: 0, id: uuid(), is_default_name: true, name: '', segments, type });
  }

  const duration = Math.max(0, ...tracks.flatMap(track => (track.segments as { target_timerange: { start: number, duration: number }}[])
    .map(({ target_timerange: range }) => range.start + range.duration)));
  const content = structuredClone(contentTemplate) as Json & { materials: Json };
  Object.assign(content, {
    id: uuid(), name, fps: baseFps, duration,
    canvas_config: { width: canvas.width, height: canvas.height, ratio: 'original' },
    materials: { ...content.materials, ...materials },
    tracks
  });
  const now = Math.floor(Date.now() / 1000);
  const meta = {
    ...structuredClone(metaTemplate),
    draft_id: uuid(), draft_name: folder,
    draft_fold_path: root ? `${root}/${folder}` : '',
    draft_root_path: root ?? '',
    tm_duration: duration,
    tm_draft_create: now,
    tm_draft_modified: now
  };
  files[`${folder}/draft_content.json`] = strToU8(JSON.stringify(content));
  files[`${folder}/draft_meta_info.json`] = strToU8(JSON.stringify(meta));
  return { blob: new Blob([zipSync(files)], { type: 'application/zip' }), skipped: [...skipped], animated };
}
