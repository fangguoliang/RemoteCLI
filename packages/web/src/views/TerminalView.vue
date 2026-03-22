<template>
  <div class="terminal-page" ref="terminalPageRef">
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
      <!-- 快捷方式下拉框 -->
      <div class="shortcuts-dropdown">
        <button class="dropdown-btn" @click="showShortcuts = !showShortcuts" :disabled="shortcuts.length === 0">
          快捷方式 ({{ shortcuts.length }})
          <span class="arrow" :class="{ open: showShortcuts }">▼</span>
        </button>
        <div class="dropdown-menu" v-show="showShortcuts">
          <div v-if="shortcuts.length === 0" class="menu-item no-shortcuts">
            暂无快捷方式
          </div>
          <div v-else>
            <div v-for="shortcut in shortcuts" :key="shortcut.id" class="menu-item shortcut-item" @click="executeShortcut(shortcut)">
              <div class="shortcut-info">
                <span class="shortcut-name">{{ shortcut.name }}</span>
                <span class="shortcut-meta">{{ shortcut.commands.length }} 条命令 · {{ agents.find(a => a.agentId === shortcut.agentId)?.name || shortcut.agentId }}</span>
              </div>
              <button class="delete-btn" @click.stop="deleteShortcutHandler(shortcut.id)" title="删除" aria-label="删除快捷方式">×</button>
            </div>
          </div>
        </div>
      </div>
      <div class="topbar-actions">
        <router-link to="/files" class="action-btn" title="文件">📁</router-link>
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
      <button class="add-tab-btn" @click="createNewTerminal" title="新建终端">+</button>
    </div>
    <!-- 终端区域 -->
    <div class="terminal-container">
      <div v-if="tabs.length === 0" class="empty-state">
        <p>选择一个 Agent 开始终端会话</p>
        <p class="hint">点击上方 "Agents" 选择在线的 Agent</p>
      </div>
      <TerminalTab v-for="tab in tabs" :key="tab.id" :tab="tab" :visible="tab.id === activeTabId" :auto-execute-commands="tab.autoExecuteCommands" />
    </div>
    <!-- 底部快捷键按钮 -->
    <div class="bottom-bar" v-if="tabs.length > 0">
      <button class="key-btn tab-btn" @click="sendKey('Tab')">Tab</button>
      <button class="key-btn capture-btn" @click="openSaveModal" :disabled="capturedCommands.length === 0" title="保存为快捷方式">📝</button>
      <div class="spacer"></div>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowLeft')">←</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowUp')">↑</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowDown')">↓</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowRight')">→</button>
      <button class="key-btn bottom-btn arrow-btn" @click="scrollToBottom" title="滚动到底部">⬇</button>
    </div>
    <div class="footer-bar">
      <span class="author">作者@fangguoliang</span>
    </div>
    <!-- 保存快捷方式弹窗 -->
    <div class="modal-overlay" v-if="showSaveModal" @click.self="closeSaveModal" @keydown.escape="closeSaveModal">
      <div class="modal">
        <div class="modal-header">
          <h3>保存快捷方式</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称</label>
            <input v-model="shortcutName" placeholder="输入快捷方式名称" />
          </div>
          <div class="form-group">
            <label>命令清单 ({{ selectedCommandTexts.length }} 条已选)</label>
            <div class="command-list">
              <div v-for="(cmd, index) in capturedCommands" :key="index" class="command-item">
                <input type="checkbox" v-model="selectedCommands[index]" />
                <span class="command-text">{{ cmd.text }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="closeSaveModal">取消</button>
          <button class="btn-save" @click="saveShortcutHandler" :disabled="!shortcutName.trim() || selectedCommandTexts.length === 0">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
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
const shortcuts = computed(() => terminalStore.shortcuts);
const capturedCommands = computed(() => terminalStore.capturedCommands);
const loading = ref(true);
const error = ref('');
const showAgents = ref(false);
const showHistory = ref(false);
const showShortcuts = ref(false);
const showSaveModal = ref(false);
const shortcutName = ref('');
const selectedCommands = ref<boolean[]>([]);

// Selected command texts
const selectedCommandTexts = computed(() => {
  return capturedCommands.value
    .filter((_, index) => selectedCommands.value[index])
    .map(cmd => cmd.text);
});

// Reference to terminal page element for visual viewport handling
const terminalPageRef = ref<HTMLElement | null>(null);

// Handle visual viewport changes for mobile keyboard
function setupVisualViewportHandling(): (() => void) | null {
  if (!('visualViewport' in window) || !terminalPageRef.value) return null;

  const terminalPage = terminalPageRef.value;

  const handleViewportChange = () => {
    // Adjust container height based on visual viewport
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    terminalPage.style.height = `${viewportHeight}px`;
  };

  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('scroll', handleViewportChange);

  // Initial setup
  handleViewportChange();

  // Return cleanup function
  return () => {
    window.visualViewport?.removeEventListener('resize', handleViewportChange);
    window.visualViewport?.removeEventListener('scroll', handleViewportChange);
  };
}

async function loadAgents(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const token = authStore.accessToken;
    if (!token) {
      error.value = 'Not authenticated';
      loading.value = false;
      // Redirect to login if not authenticated
      router.push('/login');
      return;
    }

    const response = await fetch(`${settingsStore.settings.apiUrl}/api/agents`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      // Token expired or invalid, redirect to login
      authStore.clearTokens();
      router.push('/login');
      return;
    }

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
let cleanupViewportHandling: (() => void) | null = null;

onMounted(() => {
  loadAgents().then(() => {
    // Auto-restore last active terminal after agents are loaded
    if (!sessionRestored) {
      restoreLastSession();
      sessionRestored = true;
    }
  });
  intervalId = window.setInterval(loadAgents, 5000);
  // Setup visual viewport handling for mobile keyboard
  cleanupViewportHandling = setupVisualViewportHandling();
});

// Restore all sessions from storage
// Priority: 1) sessionStorage (page refresh), 2) localStorage history (login)
function restoreLastSession() {
  // Priority: 1) sessionStorage (page refresh), 2) localStorage history (login)
  let tabsToRestore = terminalStore.getAllSessionTabs();
  let activeIdToRestore: string | null = null;

  if (tabsToRestore.length === 0) {
    tabsToRestore = terminalStore.getAllHistoryTabsForRestore();
  } else {
    // Get the active tab ID from sessionStorage (only for page refresh scenario)
    activeIdToRestore = terminalStore.getStoredActiveTabId();
  }

  if (tabsToRestore.length === 0) return;

  // Restore all tabs
  for (const tab of tabsToRestore) {
    terminalStore.restoreTab(tab);
  }

  // Restore correct active tab (the last restoreTab() sets it to that tab)
  if (activeIdToRestore && tabsToRestore.some(t => t.id === activeIdToRestore)) {
    terminalStore.setActiveTab(activeIdToRestore);
  }

  console.log('Restored', tabsToRestore.length, 'sessions');
}

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
  if (cleanupViewportHandling) cleanupViewportHandling();
});

function selectAgent(agentId: string) {
  showAgents.value = false;
  const now = Date.now();
  const tabId = 'tab-' + now + '-' + Math.random().toString(36).substr(2, 9);
  terminalStore.addTab({
    id: tabId,
    title: formatSessionTitle(now),
    agentId,
    createdAt: now,
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
  // Focus terminal after sending key
  terminalStore.focusActiveTab();
  // Update session activity
  authStore.updateLastActivity();
}

// Scroll terminal to bottom
function scrollToBottom() {
  terminalStore.scrollActiveTabToBottom();
  terminalStore.focusActiveTab();
}

// Track user activity for session timeout
function trackActivity() {
  authStore.updateLastActivity();
}

// Close dropdown when clicking outside
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.agents-dropdown')) {
    showAgents.value = false;
  }
  if (!target.closest('.shortcuts-dropdown')) {
    showShortcuts.value = false;
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

// Format timestamp as session title (e.g., "3月18日14:16")
function formatSessionTitle(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日${hour}:${minute}`;
}

// Restore terminal from history
function restoreFromHistory(tab: typeof terminalStore.historyTabs[0]) {
  showHistory.value = false;
  const agent = agents.value.find(a => a.agentId === tab.agentId);
  if (!agent?.online) {
    alert(`Agent "${tab.title}" is offline`);
    return;
  }
  // Use existing tab info to restore (don't create new history entry)
  terminalStore.restoreTab(tab);
}

// Create new terminal session (for + button)
function createNewTerminal() {
  const onlineAgent = agents.value.find(a => a.online);
  if (!onlineAgent) {
    alert('No online agents available');
    return;
  }
  selectAgent(onlineAgent.agentId);
}

// Open save modal
function openSaveModal() {
  if (capturedCommands.value.length === 0) return;
  // Select all by default
  selectedCommands.value = capturedCommands.value.map(() => true);
  shortcutName.value = '';
  showSaveModal.value = true;
  // Auto-focus input after DOM update
  nextTick(() => {
    const input = document.querySelector('.modal input[type="text"]') as HTMLInputElement;
    input?.focus();
  });
}

// Close save modal
function closeSaveModal() {
  showSaveModal.value = false;
  shortcutName.value = '';
  selectedCommands.value = [];
}

// Save shortcut
function saveShortcutHandler() {
  const activeTab = tabs.value.find(t => t.id === activeTabId.value);
  if (!activeTab) {
    alert('无法保存：没有活动的终端会话');
    return;
  }

  const success = terminalStore.saveShortcut(
    shortcutName.value,
    selectedCommandTexts.value,
    activeTab.agentId
  );

  if (success) {
    closeSaveModal();
    // Clear captured commands after saving
    terminalStore.clearCapturedCommands();
  } else {
    alert('保存失败：请确保名称不为空且至少选择一条命令');
  }
}

// Execute shortcut
function executeShortcut(shortcut: typeof shortcuts.value[0]) {
  showShortcuts.value = false;

  // Check if agent is online
  const agent = agents.value.find(a => a.agentId === shortcut.agentId);
  if (!agent?.online) {
    alert(`Agent "${shortcut.agentId}" 离线，无法执行快捷方式`);
    return;
  }

  console.log('[TerminalView] Executing shortcut:', shortcut.name, 'commands:', shortcut.commands);

  // Create new terminal with auto-execute commands
  const now = Date.now();
  const tabId = 'tab-' + now + '-' + Math.random().toString(36).slice(2, 11);
  terminalStore.addTab({
    id: tabId,
    title: shortcut.name,
    agentId: shortcut.agentId,
    createdAt: now,
    autoExecuteCommands: shortcut.commands,
  });
}

// Delete shortcut
function deleteShortcutHandler(id: string) {
  if (confirm('确定删除此快捷方式？')) {
    terminalStore.deleteShortcut(id);
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  // Track user activity for session timeout
  document.addEventListener('click', trackActivity);
  document.addEventListener('keydown', trackActivity);
  document.addEventListener('mousemove', trackActivity);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('click', trackActivity);
  document.removeEventListener('keydown', trackActivity);
  document.removeEventListener('mousemove', trackActivity);
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
  padding: 0.35rem 0.4rem;
  gap: 0.25rem;
}

.agents-dropdown {
  position: relative;
}

.dropdown-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.6rem;
  background: #1a1a2e;
  border: none;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 0.82rem;
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
  gap: 0.15rem;
  flex-shrink: 0;
}

.history-dropdown {
  position: relative;
}

.history-btn {
  padding: 0.45rem;
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 1.1rem;
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
  padding: 0.45rem;
  background: none;
  border: none;
  color: #888;
  text-decoration: none;
  cursor: pointer;
  font-size: 1.1rem;
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
  padding: 0.4rem 0.5rem;
  background: #16213e;
  gap: 0.3rem;
}

.spacer {
  flex: 1;
}

.key-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: #252547;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.9rem;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  flex-shrink: 0;
}

.key-btn:active {
  background: #e94560;
  transform: scale(0.95);
}

.tab-btn {
  width: 60px;
  font-weight: bold;
  font-size: 0.8rem;
}

.arrow-btn {
  font-size: 1.1rem;
}

.bottom-btn {
  background: #4caf50;
}

.bottom-btn:active {
  background: #388e3c;
}

/* 底部作者栏 */
.footer-bar {
  display: flex;
  justify-content: center;
  padding: 0.25rem;
  background: #16213e;
}

.author {
  font-size: 0.7rem;
  color: #666;
}

/* 快捷方式下拉框 */
.shortcuts-dropdown {
  position: relative;
}

.shortcuts-dropdown .dropdown-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shortcut-item {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.shortcut-name {
  color: #e0e0e0;
}

.shortcut-meta {
  font-size: 0.75rem;
  color: #666;
}

.delete-btn {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 1rem;
}

.delete-btn:hover {
  color: #e94560;
}

/* 记录按钮 */
.capture-btn {
  background: #e94560;
  font-size: 1.1rem;
}

.capture-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.capture-btn:not(:disabled):active {
  background: #ff6b6b;
}

/* 弹窗样式 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: #16213e;
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 1rem;
  border-bottom: 1px solid #333;
}

.modal-header h3 {
  margin: 0;
  color: #e0e0e0;
}

.modal-body {
  padding: 1rem;
  overflow-y: auto;
  flex: 1;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: #888;
  font-size: 0.85rem;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 1rem;
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: #e94560;
}

.command-list {
  max-height: 200px;
  overflow-y: auto;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 4px;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border-bottom: 1px solid #333;
}

.command-item:last-child {
  border-bottom: none;
}

.command-item input[type="checkbox"] {
  accent-color: #e94560;
}

.command-text {
  color: #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
  word-break: break-all;
}

.modal-footer {
  padding: 1rem;
  border-top: 1px solid #333;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn-cancel,
.btn-save {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-cancel {
  background: #333;
  color: #e0e0e0;
}

.btn-cancel:hover {
  background: #444;
}

.btn-save {
  background: #e94560;
  color: #fff;
}

.btn-save:hover:not(:disabled) {
  background: #ff6b6b;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>