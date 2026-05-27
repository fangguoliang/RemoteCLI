<template>
  <div class="file-view">
    <!-- Agent Selection Bar -->
    <div class="agent-bar">
      <div class="agents-dropdown">
        <button class="dropdown-btn" @click="showAgents = !showAgents">
          <span class="status-dot" :class="{ online: selectedAgentOnline }"></span>
          <span class="btn-text">{{ selectedAgentName }}</span>
          <span class="arrow" :class="{ open: showAgents }">▼</span>
        </button>
        <div class="dropdown-menu" v-show="showAgents">
          <div v-if="loadingAgents" class="menu-item loading">Loading...</div>
          <div v-else-if="agents.length === 0" class="menu-item no-agents">
            No agents available
          </div>
          <div v-else>
            <div
              v-for="agent in agents"
              :key="agent.agentId"
              class="menu-item"
              :class="{ disabled: !agent.online }"
              @click="selectAgent(agent.agentId)"
            >
              <span class="status-dot" :class="{ online: agent.online }"></span>
              {{ agent.name || agent.agentId }}
            </div>
          </div>
        </div>
      </div>
      <!-- Shortcuts Dropdown -->
      <div class="shortcuts-dropdown">
        <button class="dropdown-btn" @click="showShortcuts = !showShortcuts" :disabled="fileShortcuts.length === 0">
          <span class="btn-text">快捷方式 ({{ fileShortcuts.length }})</span>
          <span class="arrow" :class="{ open: showShortcuts }">▼</span>
        </button>
        <div class="dropdown-menu" v-show="showShortcuts">
          <div v-if="fileShortcuts.length === 0" class="menu-item no-shortcuts">
            暂无快捷方式
          </div>
          <div v-else>
            <div v-for="shortcut in fileShortcuts" :key="shortcut.id" class="menu-item shortcut-item" @click="executeFileShortcut(shortcut)">
              <div class="shortcut-info">
                <span class="shortcut-name">{{ shortcut.name }}</span>
                <span class="shortcut-path">{{ shortcut.path }}</span>
              </div>
              <button class="delete-btn" @click.stop="deleteFileShortcut(shortcut.id)" title="删除" aria-label="删除快捷方式">×</button>
            </div>
          </div>
        </div>
      </div>
      <router-link to="/terminal" class="nav-btn" title="Terminal">Terminal</router-link>
    </div>

    <!-- Path Bar -->
    <div class="path-bar">
      <div class="path-segments">
        <span
          v-for="(segment, index) in pathSegments"
          :key="index"
          class="path-segment"
          @click="navigateToSegment(index)"
        >
          {{ segment }}
        </span>
        <span v-if="pathSegments.length === 0" class="path-placeholder">Select an agent to browse files</span>
      </div>
    </div>

    <!-- File List -->
    <FileList
      :entries="entries"
      :loading="loading"
      :error="error"
      @browse="onBrowseEntry"
      @download="onDownloadEntry"
    />

    <!-- Transfer Progress -->
    <FileTransferProgress :transfers="transfers" />

    <!-- Action Bar -->
    <div class="action-bar" v-if="selectedAgentId">
      <input
        ref="pathInput"
        type="text"
        class="path-input"
        v-model="gotoPath"
        placeholder="D: or path..."
        @keyup.enter="goToPath"
      />
      <button class="action-btn" @click="goToPath">Go</button>
      <button class="icon-btn" @click="triggerUpload" title="上传">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
      </button>
      <button class="icon-btn" @click="refresh" title="刷新">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
      </button>
      <button class="icon-btn save-icon-btn" @click="openSaveModal" :disabled="!currentPath" title="保存快捷方式">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
    </div>

    <!-- Hidden File Input -->
    <input
      ref="fileInput"
      type="file"
      style="display: none"
      @change="onFileSelected"
    />

    <!-- Save Shortcut Modal -->
    <div class="modal-overlay" v-if="showSaveModal" @click.self="closeSaveModal" @keydown.escape="closeSaveModal">
      <div class="modal">
        <div class="modal-header">
          <h3>保存快捷方式</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称</label>
            <input v-model="shortcutName" placeholder="输入快捷方式名称" @keyup.enter="saveShortcutHandler" />
          </div>
          <div class="form-group">
            <label>路径</label>
            <div class="current-path">{{ currentPath }}</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="closeSaveModal">取消</button>
          <button class="btn-save" @click="saveShortcutHandler" :disabled="!shortcutName.trim()">保存</button>
        </div>
      </div>
    </div>

    <!-- Footer Bar -->
    <div class="footer-bar">
      <span class="author">作者@fangguoliang</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useFileStore } from '@/stores/file';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { useTerminalStore } from '@/stores/terminal';
import { fileWebSocket } from '@/services/fileWebSocket';
import FileList from '@/components/FileList.vue';
import FileTransferProgress from '@/components/FileTransferProgress.vue';
import { useFileShortcutsStore } from '@/stores/fileShortcuts';

const router = useRouter();
const fileStore = useFileStore();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const terminalStore = useTerminalStore();
const fileShortcutsStore = useFileShortcutsStore();

const { entries, loading, error, currentPath, transfers } = storeToRefs(fileStore);

const fileInput = ref<HTMLInputElement | null>(null);
const showAgents = ref(false);
const loadingAgents = ref(false);
const selectedAgentId = ref<string | null>(null);
const gotoPath = ref('');
const showShortcuts = ref(false);
const showSaveModal = ref(false);
const shortcutName = ref('');
const fileShortcuts = computed(() => fileShortcutsStore.shortcuts);

const agents = computed(() => {
  console.log('[FileView] computing agents, terminalStore.agents:', terminalStore.agents);
  return terminalStore.agents;
});
const onlineAgents = computed(() => {
  const result = agents.value.filter(a => a.online);
  console.log('[FileView] computing onlineAgents, result:', result.length);
  return result;
});

const selectedAgent = computed(() =>
  agents.value.find(a => a.agentId === selectedAgentId.value)
);

const selectedAgentName = computed(() => {
  if (!selectedAgentId.value) return 'Select Agent';
  const agent = selectedAgent.value;
  return agent ? (agent.name || agent.agentId) : 'Select Agent';
});

const selectedAgentOnline = computed(() => selectedAgent.value?.online ?? false);

const pathSegments = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value.split(/[/\\]/).filter(Boolean);
});

// Load agents from API
async function loadAgents(): Promise<void> {
  loadingAgents.value = true;
  try {
    const token = authStore.accessToken;
    console.log('[FileView] loadAgents, token:', token ? 'exists' : 'missing');
    if (!token) {
      // Redirect to login if not authenticated
      router.push('/login');
      return;
    }

    // Use configured apiUrl or fall back to current host
    const apiUrl = settingsStore.settings.apiUrl || `${window.location.protocol}//${window.location.host}`;
    console.log('[FileView] loadAgents, apiUrl:', apiUrl);
    const response = await fetch(`${apiUrl}/api/agents`, {
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

    if (response.ok) {
      const data = await response.json();
      console.log('[FileView] loadAgents response:', data);
      if (data.agents) {
        terminalStore.setAgents(data.agents);
        console.log('[FileView] agents set to store, store.agents:', terminalStore.agents);
      }
    }
  } catch (e) {
    console.error('Load agents error:', e);
  } finally {
    loadingAgents.value = false;
  }
}

// Connect to file WebSocket
async function connectWebSocket(): Promise<void> {
  console.log('[FileView] connectWebSocket called');
  console.log('[FileView] apiUrl:', settingsStore.settings.apiUrl);

  // Use configured apiUrl or fall back to current host
  const apiUrl = settingsStore.settings.apiUrl || `${window.location.protocol}//${window.location.host}`;
  console.log('[FileView] using apiUrl:', apiUrl);

  try {
    // Convert HTTP URL to WebSocket URL
    // Use the same /ws/browser endpoint as terminal
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws/browser';
    console.log('[FileView] Connecting to WebSocket:', wsUrl);

    await fileWebSocket.connect(wsUrl);
    console.log('File WebSocket connected');
  } catch (e) {
    console.error('Failed to connect file WebSocket:', e);
    fileStore.setError('Failed to connect to file service');
  }
}

// Select an agent
function selectAgent(agentId: string): void {
  console.log('[FileView] selectAgent called with:', agentId);
  const agent = agents.value.find(a => a.agentId === agentId);
  console.log('[FileView] agent found:', agent);
  if (!agent?.online) {
    console.log('[FileView] agent not online, returning');
    return;
  }

  showAgents.value = false;
  selectedAgentId.value = agentId;

  // Browse home directory
  console.log('[FileView] calling browse with ~ and', agentId);
  fileStore.setLoading(true);
  fileWebSocket.browse('~', agentId);
}

// Navigate to path segment
function navigateToSegment(index: number): void {
  if (!selectedAgentId.value) return;

  const segments = pathSegments.value.slice(0, index + 1);
  const newPath = segments.join('\\');
  fileWebSocket.browse(newPath, selectedAgentId.value);
}

// Browse directory entry
function onBrowseEntry(name: string): void {
  if (!selectedAgentId.value) return;

  // If it's a drive letter (e.g., "D:"), navigate directly to it
  if (name.match(/^[A-Za-z]:$/)) {
    fileWebSocket.browse(name, selectedAgentId.value);
    return;
  }

  const newPath = currentPath.value ? `${currentPath.value}\\${name}` : name;
  fileWebSocket.browse(newPath, selectedAgentId.value);
}

// Download file entry
function onDownloadEntry(name: string): void {
  const filePath = currentPath.value ? `${currentPath.value}\\${name}` : name;
  fileWebSocket.download(filePath);
}

// Trigger file upload
function triggerUpload(): void {
  fileInput.value?.click();
}

// Handle file selection for upload
function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file && currentPath.value) {
    const filePath = `${currentPath.value}\\${file.name}`;
    fileWebSocket.upload(filePath, file);
  }
  input.value = '';
}

// Refresh current directory
function refresh(): void {
  if (currentPath.value && selectedAgentId.value) {
    fileWebSocket.browse(currentPath.value, selectedAgentId.value);
  }
}

// Go to a specific path (e.g., D: or C:\Users)
function goToPath(): void {
  if (!selectedAgentId.value || !gotoPath.value.trim()) return;

  fileWebSocket.browse(gotoPath.value.trim(), selectedAgentId.value);
  gotoPath.value = '';
}

// Open save shortcut modal
function openSaveModal() {
  if (!currentPath.value || !selectedAgentId.value) return;
  shortcutName.value = '';
  showSaveModal.value = true;
}

// Close save shortcut modal
function closeSaveModal() {
  showSaveModal.value = false;
  shortcutName.value = '';
}

// Save shortcut handler
function saveShortcutHandler() {
  if (!shortcutName.value.trim() || !currentPath.value || !selectedAgentId.value) return;

  const success = fileShortcutsStore.saveShortcut(
    shortcutName.value,
    currentPath.value,
    selectedAgentId.value
  );

  if (success) {
    closeSaveModal();
  }
}

// Execute file shortcut (navigate to path)
function executeFileShortcut(shortcut: typeof fileShortcuts.value[0]) {
  showShortcuts.value = false;

  // Check if agent is online
  const agent = agents.value.find(a => a.agentId === shortcut.agentId);
  if (!agent?.online) {
    alert(`Agent "${shortcut.agentId}" 离线，无法跳转`);
    return;
  }

  // If different agent, switch to it first
  if (shortcut.agentId !== selectedAgentId.value) {
    selectedAgentId.value = shortcut.agentId;
  }

  // Navigate to the path
  fileStore.setLoading(true);
  fileWebSocket.browse(shortcut.path, shortcut.agentId);
}

// Delete file shortcut
function deleteFileShortcut(id: string) {
  if (confirm('确定删除此快捷方式？')) {
    fileShortcutsStore.deleteShortcut(id);
  }
}

// Close dropdown when clicking outside
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest('.agents-dropdown')) {
    showAgents.value = false;
  }
  if (!target.closest('.shortcuts-dropdown')) {
    showShortcuts.value = false;
  }
}

let agentLoadInterval: number | null = null;
let cwdPollInterval: number | null = null;
let wsConnected = false;
let isInitializing = false;

// Auto-refresh on upload complete
function handleUploadComplete(dir: string) {
  if (currentPath.value === dir && selectedAgentId.value) {
    fileWebSocket.browse(currentPath.value, selectedAgentId.value);
  }
}

onMounted(async () => {
  const _dbgT0 = performance.now();
  console.log('[FileView][DEBUG] ============ onMounted START ============');
  isInitializing = true;
  console.log('[FileView][DEBUG] terminalStore.tabs:', JSON.stringify(terminalStore.tabs.map(t => ({ id: t.id, agentId: t.agentId, title: t.title }))));
  console.log('[FileView][DEBUG] terminalStore.activeTabId:', terminalStore.activeTabId);
  console.log('[FileView][DEBUG] terminalStore.getActiveTabCwd():', terminalStore.getActiveTabCwd());
  document.addEventListener('click', handleClickOutside);

  // Connect WebSocket first
  console.log('[FileView][DEBUG] connecting WebSocket...', (performance.now() - _dbgT0).toFixed(0) + 'ms');
  await connectWebSocket();
  wsConnected = true;
  console.log('[FileView][DEBUG] WebSocket connected', (performance.now() - _dbgT0).toFixed(0) + 'ms');

  // Register upload complete handler
  fileWebSocket.onUploadComplete(handleUploadComplete);

  // Load agents
  console.log('[FileView][DEBUG] loading agents...', (performance.now() - _dbgT0).toFixed(0) + 'ms');
  await loadAgents();
  console.log('[FileView][DEBUG] agents loaded, online:', onlineAgents.value.length, (performance.now() - _dbgT0).toFixed(0) + 'ms');
  console.log('[FileView][DEBUG] all agents:', JSON.stringify(agents.value.map(a => ({ agentId: a.agentId, name: a.name, online: a.online }))));
  console.log('[FileView][DEBUG] onlineAgents:', JSON.stringify(onlineAgents.value.map(a => a.agentId)));
  agentLoadInterval = window.setInterval(loadAgents, 5000);

  // Auto-select first online agent if available
  console.log('[FileView][DEBUG] selectedAgentId (before auto-select):', selectedAgentId.value);
  if (onlineAgents.value.length > 0 && !selectedAgentId.value) {
    const activeTab = terminalStore.tabs.find(t => t.id === terminalStore.activeTabId);
    const activeTabAgent = activeTab ? agents.value.find(a => a.agentId === activeTab.agentId) : null;
    const activeTabCwdBefore = terminalStore.getActiveTabCwd();

    console.log('[FileView][DEBUG] activeTab found:', activeTab ? { id: activeTab.id, agentId: activeTab.agentId } : 'null');
    console.log('[FileView][DEBUG] activeTabAgent:', activeTabAgent ? { agentId: activeTabAgent.agentId, online: activeTabAgent.online } : 'null');
    console.log('[FileView][DEBUG] getActiveTabCwd():', activeTabCwdBefore);

    if (activeTab && activeTabAgent?.online) {
      console.log('[FileView][DEBUG] => branch: activeTab + online agent found, checking CWD');
      if (activeTabCwdBefore) {
        console.log('[FileView][DEBUG] => branch: CWD available immediately →', activeTabCwdBefore);
        selectedAgentId.value = activeTab.agentId;
        fileStore.setLoading(true);
        fileWebSocket.browse(activeTabCwdBefore, activeTab.agentId);
      } else {
        console.log('[FileView][DEBUG] => branch: CWD NOT available, starting CWD poll (max 120 attempts, 250ms interval = 30s)');
        selectedAgentId.value = activeTab.agentId;
        let attempts = 0;
        let cwdFound = false;
        cwdPollInterval = window.setInterval(() => {
          attempts++;
          const cwd = terminalStore.getActiveTabCwd();
          console.log(`[FileView][DEBUG] cwdPoll #${attempts}: getActiveTabCwd() =`, cwd, '| selectedAgentId:', selectedAgentId.value);
          if (cwd && selectedAgentId.value === activeTab.agentId && !cwdFound) {
            cwdFound = true;
            console.log('[FileView][DEBUG] cwdPoll SUCCESS → browsing to', cwd);
            clearInterval(cwdPollInterval!);
            cwdPollInterval = null;
            fileStore.setLoading(true);
            fileWebSocket.browse(cwd, activeTab.agentId);
          }
          if (attempts >= 120) {
            console.log('[FileView][DEBUG] cwdPoll TIMEOUT (120 attempts) → no CWD received, keeping current directory');
            clearInterval(cwdPollInterval!);
            cwdPollInterval = null;
            // Don't fall back to selectAgent - it would reset user's manual selection to ~
            // The CWD watch below will handle navigation when CWD eventually arrives
          }
        }, 250);
      }
    } else {
      console.log('[FileView][DEBUG] => branch: no activeTab or agent offline → selectAgent(onlineAgents[0])', onlineAgents.value[0].agentId);
      selectAgent(onlineAgents.value[0].agentId);
    }
  } else if (selectedAgentId.value) {
    console.log('[FileView][DEBUG] => branch: selectedAgentId already set, skipping auto-select');
  } else {
    console.log('[FileView][DEBUG] => branch: no online agents, skipping auto-select');
  }
  console.log('[FileView][DEBUG] ============ onMounted END ============');
  isInitializing = false;
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  if (agentLoadInterval) clearInterval(agentLoadInterval);
  if (cwdPollInterval) clearInterval(cwdPollInterval);
  fileWebSocket.offUploadComplete(handleUploadComplete);
  fileWebSocket.disconnect();
  wsConnected = false;
  fileStore.clearCompletedTransfers();
});

// Watch for agents changes and auto-select
watch(onlineAgents, (newOnlineAgents) => {
  console.log('[FileView][DEBUG] watch(onlineAgents) fired, wsConnected:', wsConnected, '| selectedAgentId:', selectedAgentId.value, '| isInitializing:', isInitializing, '| newOnlineCount:', newOnlineAgents.length);
  if (!wsConnected || selectedAgentId.value || isInitializing) {
    console.log('[FileView][DEBUG] watch early exit: wsConnected=', wsConnected, ', selectedAgentId=', selectedAgentId.value, ', isInitializing=', isInitializing);
    return;
  }

  // If no agent selected and there are online agents, try active tab CWD
  if (newOnlineAgents.length > 0) {
    const activeTab = terminalStore.tabs.find(t => t.id === terminalStore.activeTabId);
    const activeTabAgent = activeTab ? agents.value.find(a => a.agentId === activeTab.agentId) : null;
    const activeTabCwd = terminalStore.getActiveTabCwd();

    if (activeTabCwd && activeTab && activeTabAgent?.online) {
      selectedAgentId.value = activeTab.agentId;
      fileStore.setLoading(true);
      fileWebSocket.browse(activeTabCwd, activeTab.agentId);
    } else {
      selectAgent(newOnlineAgents[0].agentId);
    }
  }
});

// Watch for active tab CWD changes and auto-navigate (handles delayed session:output)
watch(
  () => {
    const activeTab = terminalStore.tabs.find(t => t.id === terminalStore.activeTabId);
    return activeTab ? terminalStore.getTabCwd(activeTab.id) : undefined;
  },
  (cwd) => {
    if (!cwd || !selectedAgentId.value) return;
    console.log('[FileView][DEBUG] tabCwd watch triggered, browsing to:', cwd);
    fileWebSocket.browse(cwd, selectedAgentId.value);
    // Stop polling once we have a CWD
    if (cwdPollInterval) {
      clearInterval(cwdPollInterval);
      cwdPollInterval = null;
    }
  }
);
</script>

<style scoped>
.file-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  position: relative;
  overflow: hidden;
}

.agent-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2);
  background: rgba(22, 33, 62, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-2);
  position: relative;
  z-index: 50;
}

.agents-dropdown {
  position: relative;
  max-width: 180px;
  flex-shrink: 0;
  z-index: 200;
}

.dropdown-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.45rem 0.6rem;
  background: var(--bg-surface);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.82rem;
  cursor: pointer;
  white-space: nowrap;
  max-width: 100%;
  transition: background var(--transition-fast);
}

.dropdown-btn .btn-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-btn:hover {
  background: var(--bg-surface-hover);
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
  top: calc(100% + var(--space-1));
  left: 0;
  min-width: 200px;
  max-width: 280px;
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 999;
  animation: dropdown-in 150ms ease;
}

@keyframes dropdown-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  color: var(--text-primary);
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast);
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item:hover:not(.disabled) {
  background: var(--bg-surface-hover);
}

.menu-item.disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.menu-item.loading,
.menu-item.no-agents {
  color: var(--text-muted);
  cursor: default;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}

.status-dot.online {
  background: var(--success);
  box-shadow: 0 0 6px var(--success);
}

.nav-btn {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--info);
  font-size: 0.85rem;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition-fast);
  min-height: 44px;
  display: flex;
  align-items: center;
}

.nav-btn:hover {
  background: var(--bg-surface-hover);
}

.path-bar {
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
}

.path-segments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.path-segment {
  color: var(--info);
  cursor: pointer;
  padding: var(--space-1) var(--space-1);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.path-segment:hover {
  text-decoration: underline;
  background: var(--accent-subtle);
}

.path-segment::after {
  content: ' > ';
  color: var(--text-muted);
}

.path-segment:last-child::after {
  content: '';
}

.path-placeholder {
  color: var(--text-muted);
}

.action-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: rgba(22, 33, 62, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--border-subtle);
}

.path-input {
  flex: 1;
  min-width: 60px;
  padding: var(--space-3);
  background: var(--bg-root);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.path-input::placeholder {
  color: var(--text-muted);
}

.path-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3) var(--space-4);
  height: 44px;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast), transform var(--transition-fast);
}

.action-btn:hover {
  background: var(--bg-surface-hover);
}

.action-btn:active {
  transform: scale(0.95);
}

.footer-bar {
  display: flex;
  justify-content: center;
  padding: var(--space-1);
  background: var(--bg-surface);
  border-top: 1px solid var(--border-subtle);
}

.author {
  font-size: 0.7rem;
  color: var(--text-muted);
}

/* Shortcuts dropdown */
.shortcuts-dropdown {
  position: relative;
  max-width: 150px;
  flex-shrink: 0;
  z-index: 200;
}

.shortcuts-dropdown .dropdown-btn {
  max-width: 150px;
}

.shortcuts-dropdown .dropdown-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shortcut-item {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
}

.shortcut-name {
  color: var(--text-primary);
  font-weight: 500;
}

.shortcut-path {
  font-size: 0.75rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-btn {
  padding: var(--space-1) var(--space-2);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1.2rem;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
  min-height: 44px;
  min-width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-btn:hover {
  color: var(--error);
  background: var(--accent-subtle);
}

/* Icon buttons (Upload, Refresh, Save) */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  flex-shrink: 0;
  transition: background var(--transition-fast), transform var(--transition-fast);
}

.icon-btn:hover {
  background: var(--bg-surface-hover);
}

.icon-btn:active {
  background: var(--accent);
  transform: scale(0.95);
}

.save-icon-btn {
  background: var(--accent);
  border-color: transparent;
  color: var(--text-on-accent);
}

.save-icon-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.save-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-icon-btn:active:not(:disabled) {
  background: var(--accent-hover);
  transform: scale(0.95);
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: overlay-in 150ms ease;
}

@keyframes overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: var(--bg-surface-elevated);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 400px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-default);
  animation: modal-in 200ms ease;
}

@keyframes modal-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.modal-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.1rem;
  font-weight: 600;
}

.modal-body {
  padding: var(--space-4);
  overflow-y: auto;
  flex: 1;
}

.form-group {
  margin-bottom: var(--space-4);
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
}

.form-group input[type="text"] {
  width: 100%;
  padding: var(--space-3);
  background: var(--bg-root);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 1rem;
  box-sizing: border-box;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.current-path {
  padding: var(--space-3);
  background: var(--bg-root);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--info);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.9rem;
  word-break: break-all;
}

.modal-footer {
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.btn-cancel,
.btn-save {
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition-fast), opacity var(--transition-fast);
}

.btn-cancel {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.btn-cancel:hover {
  background: var(--bg-surface-hover);
}

.btn-save {
  background: var(--accent);
  color: var(--text-on-accent);
}

.btn-save:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-item.no-shortcuts {
  color: var(--text-muted);
  cursor: default;
}
</style>