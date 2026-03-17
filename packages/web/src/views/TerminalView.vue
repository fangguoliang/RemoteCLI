<template>
  <div class="terminal-page">
    <div class="sidebar">
      <div class="agents-list">
        <h3>Agents</h3>
        <div v-if="loading" class="loading">Loading...</div>
        <div v-else-if="error" class="error">{{ error }}</div>
        <div v-else-if="agents.length === 0" class="no-agents">
          <p>No agents available</p>
          <p class="hint">Start the agent on your Windows machine</p>
        </div>
        <div v-else>
          <div v-for="agent in agents" :key="agent.agentId" class="agent-item" @click="connectToAgent(agent.agentId)">
            <span class="status" :class="{ online: agent.online }"></span>
            {{ agent.name || agent.agentId }}
          </div>
        </div>
      </div>
      <div class="actions">
        <router-link to="/settings">设置</router-link>
        <button @click="logout">登出</button>
      </div>
    </div>
    <div class="main-content">
      <div class="tabs">
        <div v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: tab.id === activeTabId }" @click="setActiveTab(tab.id)">
          {{ tab.title }}
          <span class="close" @click.stop="closeTab(tab.id)">&times;</span>
        </div>
      </div>
      <div class="terminal-container">
        <TerminalTab v-for="tab in tabs" :key="tab.id" :tab="tab" :visible="tab.id === activeTabId" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTerminalStore, type Tab } from '../stores/terminal';
import { useSettingsStore } from '../stores/settings';
import TerminalTab from '../components/TerminalTab.vue';

const router = useRouter();
const authStore = useAuthStore();
const terminalStore = useTerminalStore();
const settingsStore = useSettingsStore();

const tabs = computed(() => terminalStore.tabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const agents = computed(() => terminalStore.agents);
const loading = ref(true);
const error = ref('');

async function loadAgents() {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(`${settingsStore.settings.apiUrl}/api/agents`, {
      headers: {
        'Authorization': `Bearer ${authStore.accessToken}`,
      },
    });
    const data = await response.json();
    if (data.agents) {
      terminalStore.setAgents(data.agents);
    }
  } catch (e) {
    error.value = 'Failed to load agents';
    console.error(e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadAgents();
  // 定期刷新 Agent 列表
  setInterval(loadAgents, 5000);
});

function connectToAgent(agentId: string) {
  const tabId = crypto.randomUUID();
  terminalStore.addTab({ id: tabId, title: `Terminal ${tabs.value.length + 1}`, agentId });
}

function closeTab(id: string) {
  terminalStore.removeTab(id);
}

function setActiveTab(id: string) {
  terminalStore.setActiveTab(id);
}

function logout() {
  authStore.clearTokens();
  router.push('/login');
}
</script>

<style scoped>
.terminal-page { display: flex; height: 100vh; background: #1a1a2e; }
.sidebar { width: 200px; background: #16213e; padding: 1rem; display: flex; flex-direction: column; }
.sidebar h3 { color: #e94560; margin-bottom: 1rem; }
.agent-item { padding: 0.5rem; cursor: pointer; color: #e0e0e0; border-radius: 4px; }
.agent-item:hover { background: #1a1a2e; }
.status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #666; margin-right: 0.5rem; }
.status.online { background: #4caf50; }
.loading { color: #888; padding: 0.5rem; }
.error { color: #e94560; padding: 0.5rem; }
.no-agents { color: #888; padding: 0.5rem; }
.no-agents .hint { font-size: 0.85rem; color: #666; margin-top: 0.5rem; }
.actions { margin-top: auto; }
.actions a, .actions button { display: block; width: 100%; padding: 0.5rem; color: #a0a0a0; background: none; border: none; text-align: left; cursor: pointer; }
.actions button:hover { color: #e94560; }
.main-content { flex: 1; display: flex; flex-direction: column; }
.tabs { display: flex; background: #16213e; padding: 0.5rem 0.5rem 0; }
.tab { padding: 0.5rem 1rem; background: #1a1a2e; color: #a0a0a0; border-radius: 4px 4px 0 0; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }
.tab.active { background: #1a1a2e; color: #fff; }
.tab .close { font-size: 1.2rem; }
.tab .close:hover { color: #e94560; }
.terminal-container { flex: 1; position: relative; background: #1a1a2e; }
</style>