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

const props = defineProps<{ tab: Tab; visible: boolean; autoExecuteCommands?: string[] }>();

const terminalRef = ref<HTMLElement>();
const status = ref<'connecting' | 'connected' | 'disconnected'>('connecting');

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let sessionId: string | null = null;

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const terminalStore = useTerminalStore();

// Constants for command execution timing
const PROMPT_WAIT_INTERVAL = 100; // ms
const PROMPT_WAIT_MAX_ATTEMPTS = 20; // 2 seconds total
const COMMAND_SEND_DELAY = 100; // ms
const COMMAND_START_DELAY = 100; // ms
const TERMINAL_INIT_DELAY = 400; // ms - wait for terminal to initialize and receive output

// Execution state for cancellation
let shouldAbortExecution = false;

onMounted(() => {
  initTerminal();
});

onUnmounted(() => {
  terminalStore.unregisterKeySender(props.tab.id);
  terminalStore.unregisterTabFocuser(props.tab.id);
  terminalStore.unregisterTabScroller(props.tab.id);
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
    // Capture command when user presses Enter
    if ((data === '\r' || data === '\n') && terminal) {
      // Get current line content from terminal buffer
      const buffer = terminal.buffer.active;
      const currentLine = buffer.getLine(buffer.cursorY + buffer.baseY);
      if (currentLine) {
        const lineText = currentLine.translateToString(true);
        // Remove prompt prefix (PS C:\path> format)
        const commandMatch = lineText.match(/^PS\s+[^>]*>\s*(.*)$/);
        const commandText = commandMatch ? commandMatch[1] : lineText;
        if (commandText.trim()) {
          terminalStore.captureCommand(commandText);
        }
      }
    }
    sendInput(data);
  });

  terminal.onResize(({ cols, rows }) => {
    if (ws && sessionId) {
      ws.send(JSON.stringify({ type: 'session:resize', sessionId, payload: { cols, rows }, timestamp: Date.now() }));
    }
  });

  // Register key sender for this tab
  terminalStore.registerKeySender(props.tab.id, sendKey);

  // Register focus function for this tab
  terminalStore.registerTabFocuser(props.tab.id, () => {
    terminal?.focus();
  });

  // Register scroll to bottom function for this tab
  terminalStore.registerTabScroller(props.tab.id, () => {
    terminal?.scrollToBottom();
  });

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
        // Check if we have a sessionId to resume
        if (props.tab.sessionId) {
          // Try to resume existing session
          ws?.send(JSON.stringify({
            type: 'session:resume',
            sessionId: props.tab.sessionId,
            payload: { cols: terminal?.cols || 80, rows: terminal?.rows || 24 },
            timestamp: Date.now(),
          }));
        } else {
          // Create new session
          ws?.send(JSON.stringify({
            type: 'session:create',
            payload: { cols: terminal?.cols || 80, rows: terminal?.rows || 24, agentId: props.tab.agentId },
            timestamp: Date.now(),
          }));
        }
      }
      break;
    case 'session:created':
      if (msg.payload.success) {
        sessionId = msg.payload.sessionId;
        // Update the tab with the sessionId for persistence
        if (sessionId) {
          terminalStore.updateTabSessionId(props.tab.id, sessionId);
        }
        // Don't execute commands here - wait for session:started
      }
      break;
    case 'session:resumed':
      if (msg.payload.success) {
        sessionId = props.tab.sessionId || null;
        status.value = 'connected';
      } else {
        // Resume failed - session no longer exists on server
        // Remove from history to prevent zombie sessions
        if (props.tab.sessionId) {
          terminalStore.removeHistoryBySessionId(props.tab.sessionId);
        }
        console.log('Session resume failed, creating new session:', msg.payload.error);
        ws?.send(JSON.stringify({
          type: 'session:create',
          payload: { cols: terminal?.cols || 80, rows: terminal?.rows || 24, agentId: props.tab.agentId },
          timestamp: Date.now(),
        }));
      }
      break;
    case 'session:started':
      console.log('[TerminalTab] session:started received, autoExecuteCommands:', props.autoExecuteCommands);
      status.value = 'connected';
      // Auto-execute commands after PTY is ready
      if (props.autoExecuteCommands && props.autoExecuteCommands.length > 0) {
        console.log('[TerminalTab] Starting command execution...');
        executeCommandsSequentially(props.autoExecuteCommands);
      }
      break;
    case 'session:output':
      terminal?.write(msg.payload.data);
      break;
    case 'session:closed':
      status.value = 'disconnected';
      break;
  }
}

// Check if terminal prompt is ready (PowerShell: PS ...>)
function isPromptReady(): boolean {
  if (!terminal) return false;
  const buffer = terminal.buffer.active;
  const lastLine = buffer.getLine(buffer.length - 1);
  if (!lastLine) return false;
  const lineText = lastLine.translateToString(true).trim();
  console.log('[TerminalTab] Checking prompt, lineText:', JSON.stringify(lineText));
  // Match PowerShell prompt: PS followed by path and >
  // Also accept just PS> or lines ending with >
  return /^PS\s*.*>\s*$/.test(lineText) || lineText.endsWith('>');
}

// Execute commands sequentially, waiting for prompt between each
async function executeCommandsSequentially(commands: string[]) {
  if (!terminal || commands.length === 0) return;

  shouldAbortExecution = false;

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Wait for terminal to initialize and show first prompt
  console.log('[TerminalTab] Waiting for terminal initialization...');
  await delay(TERMINAL_INIT_DELAY);

  console.log('[TerminalTab] Terminal init wait complete, checking prompt...');

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    // Check if we should abort (component unmounted)
    if (shouldAbortExecution || !terminal) {
      console.log('[TerminalTab] Command execution aborted');
      break;
    }

    // Wait for prompt to be ready
    let attempts = 0;
    while (!isPromptReady() && attempts < PROMPT_WAIT_MAX_ATTEMPTS && !shouldAbortExecution) {
      console.log(`[TerminalTab] Waiting for prompt, attempt ${attempts + 1}/${PROMPT_WAIT_MAX_ATTEMPTS}`);
      await delay(PROMPT_WAIT_INTERVAL);
      attempts++;
    }

    if (shouldAbortExecution || !terminal) {
      console.log('[TerminalTab] Execution aborted');
      break;
    }

    if (!isPromptReady()) {
      // If prompt still not ready after max attempts, just send command anyway
      console.warn('[TerminalTab] Prompt not ready after max attempts, sending command anyway');
    }

    // Small delay before sending command
    await delay(COMMAND_SEND_DELAY);

    if (shouldAbortExecution || !terminal) break;

    console.log(`[TerminalTab] Executing command ${i + 1}/${commands.length}:`, command);
    sendInput(command + '\r');

    // Wait a bit for command to start executing
    await delay(COMMAND_START_DELAY);
  }

  console.log('[TerminalTab] Command execution complete');
}

function cleanup() {
  // Abort any pending command execution
  shouldAbortExecution = true;

  // Don't close the session when navigating away - let it persist for resume
  // Only close the WebSocket without sending session:close
  if (ws) {
    // Don't send session:close - we want to be able to resume
    // The server will handle session persistence when we disconnect
    ws.close();
  }
  terminal?.dispose();
}

// Expose method for parent component to trigger command execution
defineExpose({
  executeCommands: executeCommandsSequentially,
});
</script>

<style scoped>
.terminal-wrapper {
  position: absolute;
  inset: 0;
  touch-action: pan-y;
  overscroll-behavior: contain;
}
.terminal { width: 100%; height: 100%; }
.status-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(26, 26, 46, 0.9); color: #e0e0e0; }
.status-overlay.error { color: #e94560; }

/* xterm.js 滚动优化 */
.terminal-wrapper :deep(.xterm) {
  touch-action: pan-y;
}
.terminal-wrapper :deep(.xterm-viewport) {
  touch-action: pan-y;
  overscroll-behavior: contain;
}
</style>