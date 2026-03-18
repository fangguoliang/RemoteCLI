<template>
  <div class="terminal-wrapper" v-show="visible">
    <div ref="terminalRef" class="terminal"></div>
    <div v-if="status === 'connecting'" class="status-overlay">连接中...</div>
    <div v-if="status === 'disconnected'" class="status-overlay error">已断开</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useTerminalStore } from '../stores/terminal';
import type { Tab } from '../stores/terminal';
import 'xterm/css/xterm.css';

const props = defineProps<{ tab: Tab; visible: boolean }>();

const terminalRef = ref<HTMLElement>();
const status = ref<'connecting' | 'connected' | 'disconnected'>('connecting');

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let sessionId: string | null = null;

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const terminalStore = useTerminalStore();

onMounted(() => {
  initTerminal();
});

onUnmounted(() => {
  terminalStore.unregisterKeySender(props.tab.id);
  cleanup();
});

watch(() => props.visible, (visible) => {
  if (visible && fitAddon && terminalRef.value) {
    setTimeout(() => fitAddon?.fit(), 0);
  }
});

function initTerminal() {
  if (!terminalRef.value) return;

  terminal = new Terminal({
    fontFamily: settingsStore.settings.fontFamily,
    fontSize: settingsStore.settings.fontSize,
    theme: { background: '#1a1a2e', foreground: '#e0e0e0', cursor: '#e94560' },
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.open(terminalRef.value);
  fitAddon.fit();

  terminal.onData((data) => {
    sendInput(data);
  });

  terminal.onResize(({ cols, rows }) => {
    if (ws && sessionId) {
      ws.send(JSON.stringify({ type: 'session:resize', sessionId, payload: { cols, rows }, timestamp: Date.now() }));
    }
  });

  // Register key sender for this tab
  terminalStore.registerKeySender(props.tab.id, sendKey);

  connectWebSocket();
}

// Send input to the terminal
function sendInput(data: string) {
  if (ws && sessionId) {
    ws.send(JSON.stringify({ type: 'session:input', sessionId, payload: { data }, timestamp: Date.now() }));
  }
}

// Send special keys (Tab, Up, Down, etc.)
function sendKey(key: string) {
  const keyMap: Record<string, string> = {
    'Tab': '\t',
    'ArrowUp': '\x1b[A',
    'ArrowDown': '\x1b[B',
    'ArrowLeft': '\x1b[D',
    'ArrowRight': '\x1b[C',
    'Enter': '\r',
    'Escape': '\x1b',
    'Backspace': '\x7f',
  };
  const data = keyMap[key] || key;
  sendInput(data);
}

function connectWebSocket() {
  status.value = 'connecting';
  const apiUrl = settingsStore.settings.apiUrl || '';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = apiUrl
    ? apiUrl.replace(/^http/, 'ws') + '/ws/browser'
    : `${wsProtocol}//${window.location.host}/ws/browser`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws?.send(JSON.stringify({
      type: 'auth',
      payload: { userId: authStore.userId, agentId: props.tab.agentId },
      timestamp: Date.now(),
    }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    status.value = 'disconnected';
  };

  ws.onerror = () => {
    status.value = 'disconnected';
  };
}

function handleWsMessage(msg: any) {
  switch (msg.type) {
    case 'auth:result':
      if (msg.payload.success) {
        ws?.send(JSON.stringify({
          type: 'session:create',
          payload: { cols: terminal?.cols || 80, rows: terminal?.rows || 24, agentId: props.tab.agentId },
          timestamp: Date.now(),
        }));
      }
      break;
    case 'session:created':
      if (msg.payload.success) {
        sessionId = msg.payload.sessionId;
        status.value = 'connected';
      }
      break;
    case 'session:started':
      break;
    case 'session:output':
      terminal?.write(msg.payload.data);
      break;
    case 'session:closed':
      status.value = 'disconnected';
      break;
  }
}

function cleanup() {
  if (ws) {
    if (sessionId) {
      ws.send(JSON.stringify({ type: 'session:close', sessionId, timestamp: Date.now() }));
    }
    ws.close();
  }
  terminal?.dispose();
}
</script>

<style scoped>
.terminal-wrapper { position: absolute; inset: 0; }
.terminal { width: 100%; height: 100%; }
.status-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(26, 26, 46, 0.9); color: #e0e0e0; }
.status-overlay.error { color: #e94560; }
</style>