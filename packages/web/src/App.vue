<template>
  <router-view />
  <VoiceFloatingBar v-if="authStore.isAuthenticated" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import VoiceFloatingBar from './components/VoiceFloatingBar.vue';
import { useAuthStore } from './stores/auth';
import { useTerminalStore } from './stores/terminal';
import { initAppVoiceConnection, isVoiceWebSocketReady } from './services/voiceWebSocket';

const authStore = useAuthStore();
const terminalStore = useTerminalStore();

// 记录上次成功连接的 agentId，避免重复创建
let lastConnectedAgentId: string | null = null;
let initialSetupDone = false;

function setupVoiceConnection(forceReconnect = false) {
  if (!authStore.userId) return;

  // 找到一个在线的 agent（用于语音命令路由到 agent）
  const onlineAgent = terminalStore.agents.find(a => a.online);
  const agentId = onlineAgent?.agentId || null;

  // 如果连接已经存在且 agentId 没变，跳过
  if (!forceReconnect && isVoiceWebSocketReady() && agentId === lastConnectedAgentId) {
    return;
  }

  // 如果已经有连接但 agentId 变了（agent切换），才重新连接
  // 或者还没有连接，创建新连接
  if (forceReconnect || !isVoiceWebSocketReady() || !initialSetupDone || agentId !== lastConnectedAgentId) {
    console.log('[App] Setting up voice connection, userId:', authStore.userId, 'agentId:', agentId);
    initAppVoiceConnection(authStore.userId.toString(), agentId || undefined);
    lastConnectedAgentId = agentId;
    initialSetupDone = true;
  }
}

onMounted(() => {
  // 初始连接（可能没有 agent）
  setupVoiceConnection();

  // 1秒后再检查一次，确保有 agent 可用
  setTimeout(() => setupVoiceConnection(), 1000);
});

// 只在 agents 首次上线时重新连接，不要每次 agents 列表变化都重连
watch(() => terminalStore.agents, (newAgents, oldAgents) => {
  if (!authStore.userId) return;

  const hadOnlineAgent = oldAgents?.some(a => a.online) || false;
  const hasOnlineAgent = newAgents.some(a => a.online);

  // 只有从"无在线agent"变成"有在线agent"时才重连
  if (!hadOnlineAgent && hasOnlineAgent) {
    setupVoiceConnection(true);
  }
}, { deep: true });

onUnmounted(() => {
  // Cleanup happens when app unloads
});
</script>

<style>
/* Disable pull-to-refresh globally */
html, body {
  overscroll-behavior-y: contain;
}
</style>
