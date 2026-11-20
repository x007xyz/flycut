<template>
  <div v-if="restoring" class="m-auto" role="status">正在恢复本地草稿…</div>
  <template v-else>
    <HeaderContainer />
    <div v-if="restoreWarning || saveWarning" class="px-4 py-2 text-sm bg-amber-100 text-amber-900" role="alert">
      {{ [restoreWarning, saveWarning].filter(Boolean).join(' ') }}
    </div>
    <div class="flex flex-1 overflow-hidden">
      <ResourcesContainer />
      <div class="flex flex-1 flex-col overflow-hidden">
        <div class="flex flex-1 flex-row flex-nowrapf">
          <CanvasPlayer />
          <AttributeContainer />
        </div>
        <TrackContainer />
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
  import AttributeContainer from '@/components/container/AttributeContainer.vue';
  import CanvasPlayer from '@/components/container/CanvasPlayer.vue';
  import HeaderContainer from '@/components/container/HeaderContainer.vue';
  import ResourcesContainer from '@/components/container/ResourcesContainer.vue';
  import TrackContainer from '@/components/container/TrackContainer.vue';
  import { useEditorDraft } from '@/hooks/useEditorDraft';
  import { initHotKey } from '@/utils/initHotKey';
  const { restoring, restoreWarning, saveWarning } = useEditorDraft();
  initHotKey();
</script>
