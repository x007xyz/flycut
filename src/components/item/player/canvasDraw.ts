import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { buildScene, frameKey, type Track } from '@/render/scene';
import { drawFrame, loadFrameSources } from '@/render/drawFrame';
import { watch, reactive } from 'vue';
import type { Ref } from 'vue';

// 预览与导出共用 buildScene + drawFrame，预览直接绘制到 Canvas 2D
export class CanvasPlayer {
    player: Ref<HTMLCanvasElement>; // 播放器
    playerContext: CanvasRenderingContext2D | null = null;
    playerStore: Record<string, any>;
    trackState: Record<string, any>;
    containerSize: Record<string, any>;
    canvasSize = reactive({
        width: 0,
        height: 0
    });
    #renderId = 0;
    #paintedKey = '';
    constructor(options: Record<string, any>) {
        this.player = options.player;
        this.containerSize = options.containerSize;

        onMounted(() => {
            this.playerContext = this.player.value.getContext('2d');
            this.drawCanvas();
        });

        this.playerStore = usePlayerState();
        this.trackState = useTrackState();
        this.initWatch();
    }
    initWatch() {
        // 属性变化后重新渲染
        watch([
            () => this.trackState.trackList,
            () => this.canvasSize,
            () => this.playerStore.playStartFrame,
            () => this.playerStore.ingLoadingCount
        ], () => this.drawCanvas(), { deep: true, flush: 'post' });
    }
    // 绘制
    async drawCanvas() {
        const ctx = this.playerContext;
        if (this.playerStore.ingLoadingCount !== 0 || !ctx) return;
        const size = { width: this.playerStore.playerWidth, height: this.playerStore.playerHeight };
        const tracks: Track[] = this.trackState.trackList.flatMap(({ list }: { list: Track[] }) => list.map(track => toRaw(track)));
        const scene = buildScene(tracks, this.playerStore.playStartFrame, size, { includeEnd: true });
        const scale = window.devicePixelRatio || 1;
        const canvas = ctx.canvas;
        const width = Math.round(size.width * scale);
        const height = Math.round(size.height * scale);
        const key = `${width}x${height}:${frameKey(scene)}`;
        if (key === this.#paintedKey) return;

        const renderId = ++this.#renderId;
        const sources = await loadFrameSources(scene);
        try {
            // 较新的绘制请求已经开始，丢弃过期帧
            if (renderId !== this.#renderId) return;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            drawFrame(ctx, scene, sources, { scale });
            this.#paintedKey = key;
        } finally {
            sources.release();
        }
    }
}
