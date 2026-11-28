<template>
  <ElPopover placement="bottom" :width="280" trigger="click">
    <template #reference>
      <span class="ai-connect cursor-pointer select-none text-sm flex items-center mr-6">
        <span class="ai-status w-2 h-2 rounded-full mr-2" :data-status="bridgeStatus" :class="dotClass" />
        AI
      </span>
    </template>
    <div class="text-sm space-y-3">
      <div class="flex items-center justify-between">
        <span>本地 MCP 服务</span>
        <ElSwitch class="mcp-bridge-switch" :model-value="bridgeOn" @change="onBridge" />
      </div>
      <p class="text-xs text-gray-500">{{ bridgeText }}</p>
      <div class="flex items-center justify-between">
        <span>WebMCP</span>
        <ElSwitch class="webmcp-switch" :model-value="webMcpActive" :disabled="!webMcpSupported" @change="onWebMcp" />
      </div>
      <p class="text-xs text-gray-500">{{ webMcpSupported ? '把编辑命令注册为页面工具，供浏览器内的 AI 调用' : '当前浏览器不支持 WebMCP' }}</p>
    </div>
  </ElPopover>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { bridgeEnabled, bridgePort, bridgeStatus, setBridgeEnabled, startBridge } from '@/commands/bridge';
  import { modelContext, setWebMcpEnabled, startWebMcp, webMcpActive } from '@/commands/webmcp';

  const bridgeOn = ref(bridgeEnabled());
  const webMcpSupported = ref(false);
  const dotClass = computed(() => ({
    'bg-green-500': bridgeStatus.value === 'connected' || webMcpActive.value,
    'bg-yellow-500': bridgeStatus.value === 'connecting' && !webMcpActive.value,
    'bg-gray-400': (bridgeStatus.value === 'off' || bridgeStatus.value === 'replaced') && !webMcpActive.value
  }));
  const bridgeText = computed(() => ({
    off: `运行 node mcp/index.mjs 后打开，AI 客户端即可编辑当前工程（端口 ${bridgePort}）`,
    connecting: `正在连接 ws://127.0.0.1:${bridgePort}，请确认本地 MCP 服务已启动`,
    connected: '已连接本地 MCP 服务',
    replaced: '另一个标签页已连接本地 MCP 服务，重新打开开关可切回本页'
  }[bridgeStatus.value]));

  function onBridge(value: string | number | boolean) {
    bridgeOn.value = Boolean(value);
    if (bridgeOn.value && bridgeStatus.value === 'replaced') setBridgeEnabled(false);
    setBridgeEnabled(bridgeOn.value);
  }

  function onWebMcp(value: string | number | boolean) {
    setWebMcpEnabled(Boolean(value)).catch(error => console.error(error));
  }

  onMounted(() => {
    webMcpSupported.value = Boolean(modelContext());
    startBridge();
    startWebMcp();
  });
</script>
