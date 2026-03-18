<template>
  <div class="terminal-page">
    <!-- 顶部工具栏 -->
    <div class="topbar">
      <div class="agents-dropdown">
        <button class="dropdown-btn" @click="showAgents = !showAgents">
          <span class="status-dot" :class="{ online: onlineAgents > 0 }"></span>
          Agents ({{ onlineAgents }}/{{ agents.length }})
          <span class="arrow" :class="{ open: showAgents }">▼</span>
        </button>
        <div class="dropdown-menu" v-show="showAgents">
          <div v-if="loading" class="menu-item loading">Loading...</div>
          <div v-else-if="error" class="menu-item error">{{ error }}</div>
          <div v-else-if="agents.length === 0" class="menu-item no-agents">
            No agents available
          </div>
          <div v-else>
            <div v-for="agent in agents" :key="agent.agentId" class="menu-item" @click="selectAgent(agent.agentId)">
              <span class="status-dot" :class="{ online: agent.online }"></span>
              {{ agent.name || agent.agentId }}
            </div>
          </div>
        </div>
      </div>
      <div class="tabs">
        <div v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: tab.id === activeTabId }" @click="setActiveTab(tab.id)">
          {{ tab.title }}
          <span class="close" @click.stop="closeTab(tab.id)">×</span>
        </div>
        <button v-if="tabs.length === 0" class="new-tab-btn" @click="showAgents = !showAgents">+ New Terminal</button>
      </div>
      <div class="actions">
        <router-link to="/settings" class="action-btn" title="设置">⚙</router-link>
        <button @click="logout" class="action-btn" title="登出">⏻</button>
      </div>
    </div>
    <!-- 终端区域 -->
    <div class="terminal-container">
      <div v-if="tabs.length === 0" class="empty-state">
        <p>选择一个 Agent 开始终端会话</p>
        <p class="hint">点击上方 "Agents" 选择在线的 Agent</p>
      </div>
      <TerminalTab v-for="tab in tabs" :key="tab.id" :tab="tab" :visible="tab.id === activeTabId" />
    </div>
    <!-- 底部快捷键按钮 -->
    <div class="bottom-bar" v-if="tabs.length > 0">
      <button class="key-btn tab-btn" @click="sendKey('Tab')">Tab</button>
      <div class="spacer"></div>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowUp')">↑</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowDown')">↓</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTerminalStore } from '../stores/terminal';
import { useSettingsStore } from '../stores/settings';
import TerminalTab from '../components/TerminalTab.vue';

const router = useRouter();
const authStore = useAuthStore();
const terminalStore = useTerminalStore();
const settingsStore = useSettingsStore();

const tabs = computed(() => terminalStore.tabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const agents = computed(() => terminalStore.agents);
const onlineAgents = computed(() => agents.value.filter(a => a.online).length);
const loading = ref(true);
const error = ref('');
const showAgents = ref(false);

async function loadAgents() {
  loading.value = true;
  error.value = '';
  try {
    const token = authStore.accessToken;
    if (!token) {
      error.value = 'Not authenticated';
      loading.value = false;
      return;
    }

    const response = await fetch(`${settingsStore.settings.apiUrl}/api/agents`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      error.value = `Server error: ${response.status}`;
      loading.value = false;
      return;
    }

    const data = await response.json();
    if (data.agents) {
      terminalStore.setAgents(data.agents);
    }
  } catch (e) {
    error.value = `Failed to load agents: ${(e as Error).message}`;
    console.error('Load agents error:', e);
  } finally {
    loading.value = false;
  }
}

let intervalId: number | null = null;

onMounted(() => {
  loadAgents();
  intervalId = window.setInterval(loadAgents, 5000);
});

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
});

function selectAgent(agentId: string) {
  showAgents.value = false;
  const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
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

// Send special key to active terminal
function sendKey(key: string) {
  terminalStore.sendKeyToActive(key);
}

// Close dropdown when clicking outside
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.agents-dropdown')) {
    showAgents.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.terminal-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
}

.topbar {
  display: flex;
  align-items: center;
  background: #16213e;
  padding: 0.5rem;
  gap: 0.5rem;
  min-height: 44px;
  flex-wrap: wrap;
}

.agents-dropdown {
  position: relative;
}

.dropdown-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #1a1a2e;
  border: none;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.dropdown-btn:hover {
  background: #252547;
}

.arrow {
  font-size: 0.7rem;
  transition: transform 0.2s;
}

.arrow.open {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 200px;
  max-width: 280px;
  max-height: 300px;
  overflow-y: auto;
  background: #16213e;
  border: 1px solid #333;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  color: #e0e0e0;
  cursor: pointer;
  border-bottom: 1px solid #333;
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item:hover {
  background: #1a1a2e;
}

.menu-item.loading,
.menu-item.error,
.menu-item.no-agents {
  color: #888;
  cursor: default;
}

.menu-item.error {
  color: #e94560;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
  flex-shrink: 0;
}

.status-dot.online {
  background: #4caf50;
}

.tabs {
  display: flex;
  flex: 1;
  overflow-x: auto;
  gap: 0.25rem;
  min-width: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #1a1a2e;
  border-radius: 4px;
  color: #888;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.tab.active {
  color: #fff;
  background: #252547;
}

.tab .close {
  font-size: 1rem;
  opacity: 0.6;
}

.tab .close:hover {
  opacity: 1;
  color: #e94560;
}

.new-tab-btn {
  padding: 0.4rem 0.75rem;
  background: #e94560;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 0.25rem;
}

.action-btn {
  padding: 0.5rem;
  background: none;
  border: none;
  color: #888;
  text-decoration: none;
  cursor: pointer;
  font-size: 1rem;
}

.action-btn:hover {
  color: #e94560;
}

.terminal-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  text-align: center;
  padding: 2rem;
}

.empty-state .hint {
  color: #666;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

/* 底部快捷键按钮 */
.bottom-bar {
  display: flex;
  align-items: center;
  padding: 0.5rem;
  background: #16213e;
  gap: 0.5rem;
}

.spacer {
  flex: 1;
}

.key-btn {
  padding: 0.75rem 1.5rem;
  background: #252547;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 1rem;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

.key-btn:active {
  background: #e94560;
  transform: scale(0.95);
}

.tab-btn {
  font-weight: bold;
}

.arrow-btn {
  padding: 0.75rem 1rem;
  min-width: 50px;
}
</style>