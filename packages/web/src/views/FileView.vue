<template>
  <div class="file-view">
    <!-- Agent Selection Bar -->
    <div class="agent-bar">
      <div class="agents-dropdown">
        <button class="dropdown-btn" @click="showAgents = !showAgents">
          <span class="status-dot" :class="{ online: selectedAgentOnline }"></span>
          {{ selectedAgentName }}
          <span class="arrow" :class="{ open: showAgents }">v</span>
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
      <button class="action-btn" @click="triggerUpload">
        <span>^</span> Upload
      </button>
      <button class="action-btn" @click="refresh">
        <span>~</span> Refresh
      </button>
    </div>

    <!-- Hidden File Input -->
    <input
      ref="fileInput"
      type="file"
      style="display: none"
      @change="onFileSelected"
    />

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

const router = useRouter();
const fileStore = useFileStore();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const terminalStore = useTerminalStore();

const { entries, loading, error, currentPath, transfers } = storeToRefs(fileStore);

const fileInput = ref<HTMLInputElement | null>(null);
const showAgents = ref(false);
const loadingAgents = ref(false);
const selectedAgentId = ref<string | null>(null);
const gotoPath = ref('');

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

// Close dropdown when clicking outside
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest('.agents-dropdown')) {
    showAgents.value = false;
  }
}

let agentLoadInterval: number | null = null;
let wsConnected = false;

onMounted(async () => {
  console.log('[FileView] onMounted start');
  document.addEventListener('click', handleClickOutside);

  // Connect WebSocket first
  console.log('[FileView] connecting WebSocket...');
  await connectWebSocket();
  wsConnected = true;
  console.log('[FileView] WebSocket connected');

  // Load agents
  console.log('[FileView] loading agents...');
  await loadAgents();
  console.log('[FileView] agents loaded, onlineAgents:', onlineAgents.value.length);
  agentLoadInterval = window.setInterval(loadAgents, 5000);

  // Auto-select first online agent if available
  if (onlineAgents.value.length > 0 && !selectedAgentId.value) {
    console.log('[FileView] auto-selecting first agent:', onlineAgents.value[0].agentId);
    selectAgent(onlineAgents.value[0].agentId);
  } else {
    console.log('[FileView] no online agents or already selected');
  }
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  if (agentLoadInterval) clearInterval(agentLoadInterval);
  fileWebSocket.disconnect();
  wsConnected = false;
  fileStore.clearCompletedTransfers();
});

// Watch for agents changes and auto-select
watch(onlineAgents, (newOnlineAgents) => {
  // Don't auto-select if WebSocket not connected
  if (!wsConnected) return;

  // If current selected agent went offline, select another
  if (selectedAgentId.value && !newOnlineAgents.find(a => a.agentId === selectedAgentId.value)) {
    if (newOnlineAgents.length > 0) {
      selectAgent(newOnlineAgents[0].agentId);
    } else {
      selectedAgentId.value = null;
    }
  }
  // If no agent selected and there are online agents, select first
  else if (!selectedAgentId.value && newOnlineAgents.length > 0) {
    selectAgent(newOnlineAgents[0].agentId);
  }
});
</script>

<style scoped>
.file-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
  color: #fff;
  position: relative;
}

.agent-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  background: #16162a;
  border-bottom: 1px solid #333;
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
  background: #16162a;
  border: 1px solid #333;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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

.menu-item:hover:not(.disabled) {
  background: #1a1a2e;
}

.menu-item.disabled {
  color: #666;
  cursor: not-allowed;
}

.menu-item.loading,
.menu-item.no-agents {
  color: #888;
  cursor: default;
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

.nav-btn {
  padding: 0.5rem 0.75rem;
  background: #2a2a4e;
  border: none;
  border-radius: 4px;
  color: #4fc3f7;
  font-size: 0.85rem;
  text-decoration: none;
  cursor: pointer;
}

.nav-btn:hover {
  background: #3a3a5e;
}

.path-bar {
  padding: 12px 16px;
  background: #16162a;
  border-bottom: 1px solid #333;
  overflow-x: auto;
}

.path-segments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.path-segment {
  color: #4fc3f7;
  cursor: pointer;
}

.path-segment:hover {
  text-decoration: underline;
}

.path-segment::after {
  content: ' > ';
  color: #888;
}

.path-segment:last-child::after {
  content: '';
}

.path-placeholder {
  color: #666;
}

.action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: #16162a;
  border-top: 1px solid #333;
}

.path-input {
  flex: 1 1 120px;
  min-width: 80px;
  max-width: 200px;
  padding: 12px;
  background: #2a2a4e;
  border: 1px solid #444;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
}

.path-input::placeholder {
  color: #888;
}

.action-btn {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 16px;
  background: #2a2a4e;
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.action-btn:hover {
  background: #3a3a5e;
}

.footer-bar {
  display: flex;
  justify-content: center;
  padding: 0.25rem;
  background: #16162a;
  border-top: 1px solid #333;
}

.author {
  font-size: 0.7rem;
  color: #666;
}
</style>