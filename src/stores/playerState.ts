import { ref, toRefs, reactive } from 'vue';
import { defineStore } from 'pinia';
import { canvasRatios, defaultCanvasRatio, outputScale, type CanvasRatio } from '@/data/canvas';

export const usePlayerState = defineStore('playerState', () => {
  const ingLoadingCount = ref(0);
  // 画板信息
  const canvasOptions = reactive({
    width: 0,
    height: 0
  });
  // 要播放的总帧数
  const playerConfig = reactive({
    frameCount: 0,
    playerWidth: canvasRatios[defaultCanvasRatio].width / outputScale,
    playerHeight: canvasRatios[defaultCanvasRatio].height / outputScale
  });
  const canvasRatio = ref<CanvasRatio>(defaultCanvasRatio);
  function setCanvasRatio(ratio: CanvasRatio) {
    canvasRatio.value = ratio;
    playerConfig.playerWidth = canvasRatios[ratio].width / outputScale;
    playerConfig.playerHeight = canvasRatios[ratio].height / outputScale;
  }
  const existVideo = ref(false);
  const playStartFrame = ref(0); // 当前播放帧
  const playTargetTrackMap = ref(new Map()); // 当前播放的元素集合
  const isPause = ref(true);

  return {
    isPause,
    playStartFrame,
    ingLoadingCount,
    playTargetTrackMap,
    existVideo,
    canvasRatio,
    setCanvasRatio,
    ...toRefs(playerConfig),
    canvasOptions
  };
});
