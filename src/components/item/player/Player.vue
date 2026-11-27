<template>
  <div class="p-2 absolute top-12 bottom-10 left-2 right-2 overflow-hidden">
    <!--
 <div v-show="store.frameCount === 0 || !store.existVideo" class="absolute left-0 right-0 top-0 bottom-0 z-20 flex justify-center items-center">
      <ElIcon :size="144" class="box-content opacity-50" :style="{ color: '#FDE68A' }">
        <VideoCameraFilled />
      </ElIcon>
    </div> 
-->
    <!-- <Loading class="justify-center pl-0 bg-opacity-0" /> -->
    <PlayerMoveable :zoom="scale" :style="{ zoom: scale, width: `${playerWidth}px`, height: `${playerHeight}px` }" />
  </div>
  <PlayerControl />
</template>

<script setup lang="ts">
  import PlayerMoveable from '@/components/item/player/PlayerMoveable.vue';
  import PlayerControl from '@/components/item/player/PlayerControl.vue';
  import { VideoCameraFilled } from '@element-plus/icons-vue';
  import Loading from '@/components/Loading.vue';
  import { computed } from 'vue';
  import { usePlayerState } from '@/stores/playerState';
  import { storeToRefs } from 'pinia';
  const props = defineProps({
    containerSize: { // 容器大小
      type: Object,
      default() {
        return {
          width: 0,
          height: 0
        };
      }
    }
  });
  const store = usePlayerState();

  const { playerWidth, playerHeight } = storeToRefs(store);

  const scale = computed(() => {
    let { width, height } = props.containerSize;
    height -= 96; // 上下功能栏
    width -= 16; // 左右功能栏
    return Math.min(width / playerWidth.value, height / playerHeight.value);
  });
</script>