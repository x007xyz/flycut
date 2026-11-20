<template>
  <div ref="viewport" class="absolute top-12 bottom-10 left-2 right-2 overflow-hidden">
    <div class="absolute inset-0 m-auto overflow-hidden bg-black isolate pointer-events-none" :style="stageStyle">
      <template v-for="(layer, index) in layers" :key="index">
        <PlayerVideo
          v-if="layer.type === 'video' && layer.track"
          :key="layer.track.id"
          :track="layer.track"
          :size="size"
          :frame="frame"
          :paused="store.isPause"
          @presented="setPresentedTime"
        />
        <PlayerGraphics
          v-else-if="layer.type === 'graphics'"
          :lines="layer.lines"
          :size="size"
          :frame="layer.frame"
          :scale="scale"
        />
      </template>
    </div>
    <PlayerMoveable :style="stageStyle" />
  </div>
  <PlayerControl />
</template>

<script setup lang="ts">
  import PlayerMoveable from '@/components/item/player/PlayerMoveable.vue';
  import PlayerControl from '@/components/item/player/PlayerControl.vue';
  import PlayerVideo from '@/components/item/player/PlayerVideo.vue';
  import PlayerGraphics from '@/components/item/player/PlayerGraphics.vue';
  import { computed, reactive, ref } from 'vue';
  import { useElementSize } from '@vueuse/core';
  import { usePlayerState } from '@/stores/playerState';
  import { useTrackState } from '@/stores/trackState';
  import { getPreviewFrame, isActiveAt } from '@/utils/timelineGeometry';
  import { timelineFrameAt } from '@/utils/previewVideo';
  import type { TrackLineItem } from '@/class/Track';
  import { VideoTrack } from '@/class/VideoTrack';

  const store = usePlayerState();
  const tracks = useTrackState();
  const viewport = ref<HTMLDivElement>();
  const viewportSize = useElementSize(viewport);
  const size = computed(() => ({ width: store.playerWidth, height: store.playerHeight }));
  const scale = computed(() => Math.min(
    viewportSize.width.value / size.value.width, viewportSize.height.value / size.value.height
  ));
  const stageStyle = computed(() => ({
    zoom: scale.value, width: `${size.value.width}px`, height: `${size.value.height}px`
  }));
  const frame = computed(() => getPreviewFrame(store.playStartFrame, tracks.frameCount));
  const presented = reactive(new Map<string, number>());
  const rows = computed(() => {
    const groups: ({ type: 'video'; line: TrackLineItem } | { type: 'graphics'; lines: TrackLineItem[] })[] = [];
    for (const line of (tracks.trackList as TrackLineItem[]).slice().reverse()) {
      if (line.type === 'video') {
        groups.push({ type: 'video', line });
      } else if (line.type !== 'audio') {
        const last = groups[groups.length - 1];
        if (last?.type === 'graphics') last.lines.unshift(line);
        else groups.push({ type: 'graphics', lines: [line] });
      }
    }
    return groups;
  });
  const layers = computed(() => {
    let graphicsFrame = frame.value;
    return rows.value.map(group => {
      if (group.type === 'graphics') return { ...group, frame: graphicsFrame };
      const track = group.line.list.find((item): item is VideoTrack => item instanceof VideoTrack && isActiveAt(item, frame.value));
      if (track) {
        const time = presented.get(track.id);
        graphicsFrame = time === undefined ? frame.value : timelineFrameAt(track, time);
      }
      return { type: group.type, track };
    });
  });

  function setPresentedTime(id: string, time: number | null) {
    if (time === null) presented.delete(id);
    else presented.set(id, time);
  }
</script>
