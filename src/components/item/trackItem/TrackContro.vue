<template>
  <div class="pl-4 pb-1 pr-10 w-full h-10 border-b dark:border-darker border-gray-300">
    <div
      class="float-left h-9 w-32 flex flex-row flex-nowrap items-center justify-around"
    >
      <div v-for="item of icons" :key="item.label" @click="handlerIcon(item)">
        <el-tooltip
          :disabled="item.disable"
          class="bg-gray-400"
          :effect="store.isDark ? 'dark' : 'light'"
          :content="item.title"
          placement="bottom-start"
        >
          <component
            :is="item.icon"
            class="focus:outline-0"
            :class="item.disable ? 'cursor-not-allowed text-gray-400' : ''"
          />
        </el-tooltip>
      </div>
    </div>
    <div class="float-right flex w-52 h-9 justify-center items-center">
      <SubIcon :style="svgStyle" class="cursor-pointer mr-4" @click="changeScale(-10)" />
      <el-slider v-model="modelValue" v-bind="sliderProps" />
      <AddIcon :style="svgStyle" class="cursor-pointer ml-4" @click="changeScale(10)" />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { usePageState } from '@/stores/pageState';
  import { useTrackState } from '@/stores/trackState';
  import { usePlayerState } from '@/stores/playerState';
  import { ref, reactive, computed } from 'vue';
  const props = defineProps({
    modelValue: {
      type: Number,
      default: 30
    }
  });
  const emit = defineEmits({
    'update:modelValue': val => {
      return val !== null;
    }
  });
  const modelValue = computed({
    get() {
      return props.modelValue;
    },
    set(value) {
      emit('update:modelValue', value);
    }
  });
  const store = usePageState();
  const trackStore = useTrackState();
  const playerStore = usePlayerState();
  const svgStyle = ref({
    fontSize: '1.75rem',
    padding: '0.25rem',
    boxSizing: 'content-box'
  });
  const sliderProps = reactive({
    showTooltip: false,
    size: 'small',
    step: 10,
    max: 100,
    min: 0
  });
  function changeScale(val: number) {
    let newVal = modelValue.value + val;
    if (newVal > sliderProps.max) newVal = sliderProps.max;
    if (newVal < sliderProps.min) newVal = sliderProps.min;
    modelValue.value = newVal;
  }
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const icons = computed(() => [
    {
      label: '撤销',
      title: `撤销 (${mod}Z)`,
      disable: !trackStore.canUndo,
      icon: 'UndoIcon'
    },
    {
      label: '重做',
      title: `重做 (${mod}Shift+Z)`,
      disable: !trackStore.canRedo,
      icon: 'RedoIcon'
    },
    {
      label: '分割',
      title: `分割 (${mod}B)`,
      disable: trackStore.selectTrackItem.line === -1 && trackStore.selectTrackItem.index === -1,
      icon: 'SplitIcon'
    },
    {
      label: '删除',
      title: '删除 (Delete)',
      disable: trackStore.selectTrackItem.line === -1 && trackStore.selectTrackItem.index === -1,
      icon: 'DeleteIcon'
    }
  ]);

  function handlerIcon(item: Record<string, any>) {
    const { icon: type, disable } = item;
    if (disable) {
      return;
    }
    if (type === 'DeleteIcon') {
      trackStore.removeSelected();
    } else if (type === 'UndoIcon') {
      trackStore.undo();
    } else if (type === 'RedoIcon') {
      trackStore.redo();
    } else if (type === 'SplitIcon') {
      trackStore.splitSelected(playerStore.playStartFrame, { width: playerStore.playerWidth, height: playerStore.playerHeight });
    }
  }
</script>