<template>
  <header class="h-14 w-full flex flex-nowrap flex-row items-center justify-between border-b dark:border-b-2 dark:border-darker border-gray-200">
    <div class="flex w-1/3 pl-2 items-center">
      <svg
      height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32"
      data-view-component="true" class="github-icon mx-4 cursor-pointer" :class="store.isDark ? 'text-white' : 'text-black'" @click="openGithub"
      >
          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
      <div class="ml-2">
        <img class="h-8" src="@/assets/text_logo.png" alt="">
      </div>
      <ElDropdown class="ml-6 project-menu" trigger="click" @command="onProjectCommand">
        <span class="cursor-pointer select-none text-sm flex items-center">
          <span class="project-name max-w-48 truncate">{{ project.current?.name ?? '' }}</span>
          <ElIcon class="ml-1"><ArrowDown /></ElIcon>
        </span>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem command="rename">重命名</ElDropdownItem>
            <ElDropdownItem command="create">新建工程</ElDropdownItem>
            <ElDropdownItem command="import">导入工程（.flycut）</ElDropdownItem>
            <ElDropdownItem command="export">导出工程（.flycut）</ElDropdownItem>
            <ElDropdownItem command="remove">删除当前工程</ElDropdownItem>
            <ElDropdownItem
              v-for="(item, index) in otherProjects"
              :key="item.id"
              :command="`open:${item.id}`"
              :divided="index === 0"
            >
              打开：{{ item.name }}
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
    <div class="flex w-1/3 flex-row-reverse pr-10 items-center">
      <ElButton color="#683CFD" size="default" :disabled="exporting" @click="onGenerate">
        <ElIcon :size="size" color="#fff" class="mr-1">
          <Download />
        </ElIcon>
        合成视频
      </ElButton>
      <el-switch
        class="mr-10"
        size="large"
        :active-icon="Moon"
        :inactive-icon="Sunny"
        :inline-prompt="inner"
        v-model="store.isDark"
        :style="switchClass"
      /> 
</div>
  </header>
</template>

<script setup lang="ts">
  /* eslint-disable camelcase */
  import { ref, computed, toRaw } from 'vue';
  import { ArrowDown, Download, Sunny, Moon } from '@element-plus/icons-vue';
  import { usePageState } from '@/stores/pageState';
  import { useTrackState } from '@/stores/trackState';
  import { usePlayerState } from '@/stores/playerState';
  import { isExportSupported, renderTimeline, type Track } from '@/utils/renderTimeline';
  import { createFileWriter } from '@/utils/common';
  import { saveRenderedVideo } from '@/utils/videoExport';
  import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';
  import 'element-plus/es/components/message-box/style/css';
  import { useProjectState } from '@/stores/projectState';
  import { useResourceState } from '@/stores/resourceStore';
  import { packProject, unpackProject } from '@/storage/projectPackage';
  import { assetIdsOf, captureTimeline, encodeDraft } from '@/utils/editorDraft';
  import { selectFile } from '@/utils/file';

  const trackState = useTrackState();

  const playerState = usePlayerState();

  const project = useProjectState();
  const resources = useResourceState();
  const otherProjects = computed(() => project.projects.filter(({ id }) => id !== project.current?.id));

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportProject() {
    const lines = captureTimeline(trackState.trackList);
    const json = encodeDraft(lines, trackState.trackScale, playerState.playStartFrame);
    const name = project.current?.name ?? '工程';
    download(await packProject(name, json, assetIdsOf(lines)), `${name}.flycut`);
  }

  async function importProject() {
    const [file] = await selectFile({ accept: '.flycut', multiple: false }).catch(() => []);
    if (!file) return;
    const { meta, assets } = await unpackProject(file);
    assets.forEach(record => resources.add(record));
    await project.switchTo(meta.id);
  }

  async function prompt(title: string, value: string) {
    const { value: name } = await ElMessageBox.prompt('', title, { inputValue: value, confirmButtonText: '确定', cancelButtonText: '取消' });
    return name.trim();
  }

  async function onProjectCommand(command: string) {
    try {
      if (command === 'rename') {
        const name = await prompt('重命名工程', project.current?.name ?? '');
        if (name) await project.rename(name);
      } else if (command === 'create') await project.create();
      else if (command === 'import') await importProject();
      else if (command === 'export') await exportProject();
      else if (command === 'remove') {
        await ElMessageBox.confirm(`删除工程“${project.current?.name}”？素材会保留在素材库中。`, '删除工程', { confirmButtonText: '删除', cancelButtonText: '取消' });
        await project.removeCurrent();
      } else if (command.startsWith('open:')) await project.switchTo(command.slice(5));
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      console.error(error);
      ElMessage.error('工程操作失败');
    }
  }

  const store = usePageState();
  const size = ref(14);
  const inner = ref(true);
  const exporting = ref(false);
  const switchClass = computed(() => ({
    '--el-switch-border-color': store.isDark ? '#4B5563' : '#D1D5DB',
    '--el-color-white': store.isDark ? '#F3F4F6' : '#374151'
  }));

  async function chooseDestination() {
    try {
      // The save picker needs a fresh user gesture after rendering.
      await ElMessageBox.confirm('视频已合成，是否保存 MP4？', '合成完成', {
        confirmButtonText: '保存 MP4',
        cancelButtonText: '取消',
        closeOnClickModal: false
      });
      return await createFileWriter();
    } catch (error) {
      if (error === 'cancel' || error === 'close' || (error instanceof DOMException && error.name === 'AbortError')) {
        return undefined;
      }
      throw error;
    }
  }

  async function generateVideo() {
    if (!trackState.frameCount) {
      ElMessage.warning('请先添加素材');
      return;
    }
    if (typeof window.showSaveFilePicker !== 'function') {
      ElMessage.error('当前浏览器不支持保存视频，请使用 Chrome 或 Edge');
      return;
    }

    const loading = ElLoading.service({ text: '正在合成视频' });
    try {
      if (!await isExportSupported()) {
        ElMessage.error('当前浏览器不支持 MP4 所需的 H.264 或 Opus 编码，请更换浏览器后重试');
        return;
      }

      const tracks = toRaw(trackState.trackList).flatMap(({ list }) => list.map(track => toRaw(track) as Track));
      const playerSize = { width: playerState.playerWidth, height: playerState.playerHeight };
      const saved = await saveRenderedVideo(target => renderTimeline(tracks, playerSize, target), () => {
        loading.close();
        return chooseDestination();
      });
      if (saved) ElMessage.success('合成视频成功');
    } catch (error) {
      console.error(error);
      ElMessage.error('导出视频失败，请重试');
    } finally {
      loading.close();
    }
  }

  async function onGenerate() {
    if (exporting.value) return;
    exporting.value = true;
    await generateVideo().finally(() => {
      exporting.value = false;
    });
  }

  function openGithub() {
    window.open('https://github.com/x007xyz/fly-cut.git');
  }
</script>

<style>
.github-icon {
  fill: currentColor;
}
</style>
