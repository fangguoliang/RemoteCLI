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
      <div class="topbar-actions">
        <div class="history-dropdown" v-if="historyTabs.length > 0">
          <button class="history-btn" @click="showHistory = !showHistory" title="历史记录">
            📋
          </button>
          <div class="dropdown-menu history-menu" v-show="showHistory">
            <div class="menu-header">历史终端 ({{ historyTabs.length }})</div>
            <div v-for="tab in historyTabs" :key="tab.id" class="menu-item history-item" @click="restoreFromHistory(tab)">
              <span class="status-dot" :class="{ online: agents.find(a => a.agentId === tab.agentId)?.online }"></span>
              <div class="history-info">
                <span class="history-title">{{ tab.title }}</span>
                <span class="history-time">{{ formatTime(tab.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
        <router-link to="/settings" class="action-btn" title="设置">⚙</router-link>
        <button @click="logout" class="action-btn" title="登出">⏻</button>
      </div>
    </div>
    <!-- 会话标签栏 - 第二行 -->
    <div class="tabs-bar" v-if="tabs.length > 0">
      <div class="tabs-scroll">
        <div class="tabs">
          <div v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: tab.id === activeTabId }" @click="setActiveTab(tab.id)">
            {{ tab.title }}
            <span class="close" @click.stop="closeTab(tab.id)">×</span>
          </div>
        </div>
      </div>
      <button class="add-tab-btn" @click="showAgents = !showAgents" title="新建终端">+</button>
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
const historyTabs = computed(() => terminalStore.historyTabs);
const loading = ref(true);
const error = ref('');
const showAgents = ref(false);
const showHistory = ref(false);

async function loadAgents(): Promise<void> {
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
let sessionRestored = false;

onMounted(() => {
  loadAgents().then(() => {
    // Auto-restore last active terminal after agents are loaded
    if (!sessionRestored) {
      restoreLastSession();
      sessionRestored = true;
    }
  });
  intervalId = window.setInterval(loadAgents, 5000);
});

// Restore last session if agent is online
// Priority: 1) sessionStorage session (page refresh), 2) localStorage history (new login)
function restoreLastSession() {
  // First try to restore from sessionStorage (page refresh scenario)
  let lastTab = terminalStore.getLastActiveTab();

  // If no session, try to restore from history (new login scenario)
  if (!lastTab) {
    lastTab = terminalStore.getLastHistoryTab();
  }

  if (!lastTab) return;

  const agent = agents.value.find(a => a.agentId === lastTab.agentId);
  if (agent?.online) {
    // Create terminal with same agent and sessionId for resume
    const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    terminalStore.addTab({
      id: tabId,
      title: agent.name || lastTab.agentId,
      agentId: lastTab.agentId,
      createdAt: Date.now(),
      sessionId: lastTab.sessionId, // Pass sessionId for resume
    });
    console.log('Restored session for agent:', lastTab.agentId, 'sessionId:', lastTab.sessionId);
  } else {
    // Agent offline, just clear current session (keep history)
    terminalStore.clearCurrentSession();
    console.log('Agent offline:', lastTab.agentId);
  }
}

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
});

function selectAgent(agentId: string) {
  showAgents.value = false;
  const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const agent = agents.value.find(a => a.agentId === agentId);
  terminalStore.addTab({
    id: tabId,
    title: agent?.name || agentId,
    agentId,
    createdAt: Date.now(),
  });
}

function closeTab(id: string) {
  terminalStore.removeTab(id);
}

function setActiveTab(id: string) {
  terminalStore.setActiveTab(id);
}

function logout() {
  authStore.clearTokens();
  terminalStore.clearCurrentSession();
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
  if (!target.closest('.history-dropdown')) {
    showHistory.value = false;
  }
}

// Format timestamp to readable time
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString();
}

// Restore terminal from history
function restoreFromHistory(tab: typeof terminalStore.historyTabs[0]) {
  showHistory.value = false;
  const agent = agents.value.find(a => a.agentId === tab.agentId);
  if (!agent?.online) {
    alert(`Agent "${tab.title}" is offline`);
    return;
  }
  const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  terminalStore.addTab({
    id: tabId,
    title: agent.name || tab.agentId,
    agentId: tab.agentId,
    createdAt: Date.now(),
    sessionId: tab.sessionId, // Pass sessionId for resume
  });
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
  justify-content: space-between;
  background: #16213e;
  padding: 0.5rem;
  gap: 0.5rem;
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

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.history-dropdown {
  position: relative;
}

.history-btn {
  padding: 0.5rem;
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 1rem;
}

.history-btn:hover {
  color: #e0e0e0;
}

.history-menu {
  right: 0;
  left: auto;
  min-width: 220px;
}

.menu-header {
  padding: 0.5rem 0.75rem;
  color: #888;
  font-size: 0.75rem;
  border-bottom: 1px solid #333;
}

.history-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
}

.history-title {
  color: #e0e0e0;
}

.history-time {
  font-size: 0.75rem;
  color: #666;
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

/* 会话标签栏 - 第二行 */
.tabs-bar {
  display: flex;
  align-items: center;
  background: #1a1a2e;
  padding: 0.25rem 0.5rem;
  gap: 0.5rem;
  border-bottom: 1px solid #333;
}

.tabs-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  /* 隐藏滚动条但保留滚动功能 */
  scrollbar-width: thin;
  scrollbar-color: #333 transparent;
}

.tabs-scroll::-webkit-scrollbar {
  height: 4px;
}

.tabs-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.tabs-scroll::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 2px;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  white-space: nowrap;
}

.tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #16213e;
  border-radius: 4px;
  color: #888;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
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

.add-tab-btn {
  padding: 0.4rem 0.75rem;
  background: #e94560;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.add-tab-btn:hover {
  background: #ff6b6b;
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