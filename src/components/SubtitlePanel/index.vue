<template>
  <div class="subtitle-panel p-4 flex-1 overflow-y-auto flex flex-col gap-3 text-sm">
    <p class="text-xs text-gray-500 select-none">在浏览器本地识别时间轴上的语音，每句生成一个文字片段。首次使用需要下载模型，之后会缓存。</p>
    <ElSelect v-model="model" size="default" :disabled="busy">
      <ElOption v-for="item in asrModels" :key="item.id" :label="item.label" :value="item.id" />
    </ElSelect>
    <ElSelect v-model="language" size="default" :disabled="busy">
      <ElOption v-for="item in asrLanguages" :key="item.id" :label="item.label" :value="item.id" />
    </ElSelect>
    <ElButton class="subtitle-generate" color="#683CFD" :loading="busy" @click="onGenerate">识别字幕</ElButton>
    <p v-if="busy" class="subtitle-progress text-xs text-gray-500">{{ progressText }}</p>
    <div class="flex gap-2">
      <ElButton class="flex-1 subtitle-import" :disabled="busy" @click="srtInput?.click()">导入 SRT</ElButton>
      <ElButton class="flex-1 subtitle-export" :disabled="busy" @click="onExport">导出 SRT</ElButton>
    </div>
    <input ref="srtInput" type="file" accept=".srt,.vtt,text/plain" class="hidden" @change="onImport">
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue';
  import { ElMessage } from 'element-plus';
  import { addSubtitles, asrLanguages, asrModels, defaultAsrLanguage, textSegments, transcribeTimeline } from '@/subtitles';
  import { formatSrt, parseSrt } from '@/subtitles/srt';

  const model = ref(asrModels[0].id);
  const language = ref(defaultAsrLanguage());
  const busy = ref(false);
  const progressText = ref('');
  const srtInput = ref<HTMLInputElement>();
  const stages = { audio: '正在提取音频', download: '正在下载模型', transcribe: '正在识别语音' };

  async function onGenerate() {
    busy.value = true;
    try {
      const segments = await transcribeTimeline({
        model: model.value,
        language: language.value,
        onProgress(stage, progress) {
          progressText.value = stage === 'download' ? `${stages[stage]} ${progress}%` : stages[stage];
        }
      });
      if (!segments.length) ElMessage.warning('没有识别到语音');
      else ElMessage.success(`已添加 ${addSubtitles(segments).length} 条字幕`);
    } catch (error) {
      console.error(error);
      ElMessage.error(error instanceof Error ? error.message : '识别字幕失败');
    } finally {
      busy.value = false;
      progressText.value = '';
    }
  }

  async function onImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const segments = parseSrt(await file.text());
    if (!segments.length) {
      ElMessage.warning('文件中没有有效的字幕');
      return;
    }
    ElMessage.success(`已导入 ${addSubtitles(segments).length} 条字幕`);
  }

  function onExport() {
    const segments = textSegments();
    if (!segments.length) {
      ElMessage.warning('时间轴上没有文字片段');
      return;
    }
    const url = URL.createObjectURL(new Blob([formatSrt(segments)], { type: 'application/x-subrip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'subtitles.srt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
  }
</script>
