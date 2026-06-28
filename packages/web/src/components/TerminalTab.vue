<template>
  <div class="terminal-wrapper" v-show="visible">
    <div ref="terminalRef" class="terminal"></div>
    <div v-if="status === 'connecting'" class="status-overlay">
      <div class="spinner"></div>
      <span>连接中...</span>
    </div>
    <div v-if="status === 'disconnected'" class="status-overlay error">已断开</div>
    <MarkdownViewer />
    <WebViewer />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useTerminalStore } from '../stores/terminal';
import { useFileStore } from '../stores/file';
import { useWebViewerStore } from '../stores/webViewer';
import { fileWebSocket } from '../services/fileWebSocket';
import { initVoiceWebSocket, clearTerminalVoiceWebSocket, sendActiveTerminalSession } from '../services/voiceWebSocket';
import { blackbox } from '../utils/eventLogger';
import type { Tab } from '../stores/terminal';
import MarkdownViewer from './MarkdownViewer.vue';
import WebViewer from './WebViewer.vue';
import 'xterm/css/xterm.css';

const props = defineProps<{ tab: Tab; visible: boolean; autoExecuteCommands?: string[] }>();

const terminalRef = ref<HTMLElement>();
const status = ref<'connecting' | 'connected' | 'disconnected'>('connecting');

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let serializeAddon: SerializeAddon | null = null;
let ws: WebSocket | null = null;
let sessionId: string | null = null;
let saveScrollbackTimer: number | null = null;
let terminalInitialized = false; // Track if terminal has been initialized
let shouldSendResize = true; // Control whether to send resize to server
let userScrolledUp = false; // Track if user manually scrolled up from bottom
// [debug-loop] fix: Track last sent dimensions to prevent duplicate session:resize
// when fit() is called multiple times with same dimensions (e.g., from
// TerminalView + TerminalTab both having viewport handlers).
let lastSentCols = 0;
let lastSentRows = 0;

// [debug-loop] Track safeFit execution stats for debug panel
let safeFitStats = { calls: 0, skipped: 0, fitted: 0, lastRectH: 0, lastCols: 0, lastRows: 0 };

// [debug-loop] Track session:output message count
let sessionOutputCount = 0;

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const terminalStore = useTerminalStore();
const fileStore = useFileStore();
const webViewerStore = useWebViewerStore();

// Constants for command execution timing
const PROMPT_WAIT_INTERVAL = 100; // ms
const PROMPT_WAIT_MAX_ATTEMPTS = 20; // 2 seconds total
const COMMAND_SEND_DELAY = 100; // ms
const COMMAND_START_DELAY = 100; // ms
const TERMINAL_INIT_DELAY = 400; // ms - wait for terminal to initialize and receive output

// Execution state for cancellation
let shouldAbortExecution = false;

// [debug-loop] fix: typed input buffer for cd detection
// PTY echo has latency — when user presses Enter, the typed chars may not
// yet be in the terminal buffer. Track typed chars separately so we can
// detect cd commands at Enter time without waiting for echo.
// [debug-loop] fix: when true, the next PS prompt in session:output is from user's command
// (not stale session:resume output), so it's safe to extract CWD from it
let waitingForFreshPrompt = false;

// Parse current working directory from terminal buffer
// Handles standard PowerShell prompt "PS D:\path>" and Starship prompt "D:\path ❯"
function parseCwdFromBuffer(): string | null {
  if (!terminal) return null;

  const buffer = terminal.buffer.active;
  const bufferLength = buffer.length;

  // Debug: log buffer overview on each call
  console.log('[TerminalTab][CWD-Parse] bufferLength:', bufferLength, 'baseY:', buffer.baseY);

  // Look back up to 20 lines from the bottom
  for (let i = bufferLength - 1; i >= Math.max(0, bufferLength - 20); i--) {
    const line = buffer.getLine(i);
    if (!line) continue;

    const lineText = line.translateToString(true);

    // Debug: log every line examined
    console.log('[TerminalTab][CWD-Parse] line', i, '/', bufferLength, '| isWrapped:', line.isWrapped, '| text:', JSON.stringify(lineText.substring(0, 80)));

    // Try to match standard PowerShell prompt: "PS D:\path>" or "PS C:\Users\admin>"
    const psMatch = lineText.match(/PS\s+([A-Za-z]:[^\r\n>]+)>/);
    if (psMatch) {
      console.log('[TerminalTab] Found PowerShell prompt CWD:', psMatch[1].trim());
      return psMatch[1].trim();
    }

    // Try to match Starship-style prompt: path before "❯" symbol
    // Format: "D:\path ❯" or "D:\path on branch ❯"
    const starshipMatch = lineText.match(/([A-Za-z]:[^\r\n❯]+?)\s*(?:on\s+\w+\s*)?❯/);
    if (starshipMatch) {
      const cwd = starshipMatch[1].trim();
      console.log('[TerminalTab] Found Starship prompt CWD:', cwd);
      return cwd;
    }

    // Also try: just a path followed by prompt symbols
    const pathMatch = lineText.match(/^([A-Za-z]:[\\\/][^\r\n]+?)\s*[❯>$]/);
    if (pathMatch) {
      console.log('[TerminalTab] Found path prompt CWD:', pathMatch[1].trim());
      return pathMatch[1].trim();
    }
  }

  console.log('[TerminalTab] Could not parse CWD from buffer');
  return null;
}

// Handle .md path click
// Debounce for handleMdPathClick - prevent double trigger from link provider + direct click
let mdClickDebounce = 0;

function handleMdPathClick(matchedPath: string) {
  // Check debounce - prevent duplicate within 200ms
  const now = Date.now();
  if (now - mdClickDebounce < 200) {
    console.log('[TerminalTab] handleMdPathClick debounced:', matchedPath);
    return;
  }
  mdClickDebounce = now;

  console.log('[TerminalTab] handleMdPathClick:', matchedPath, 'sessionId:', sessionId);

  // Validate: sessionId must exist
  if (!sessionId) {
    console.log('[TerminalTab] no sessionId, skipping');
    return;
  }

  // Parse CWD from terminal buffer for relative paths
  let pathToSend = matchedPath;
  const isAbsolutePath = /^[A-Za-z]:/.test(matchedPath) || /^[.\/]/.test(matchedPath);

  if (!isAbsolutePath) {
    const cwd = parseCwdFromBuffer();
    if (cwd) {
      // Build absolute path from relative path and CWD
      // Handle both \ and / path separators
      const normalizedCwd = cwd.replace(/\//g, '\\');
      const normalizedPath = matchedPath.replace(/\//g, '\\');

      // Simple concatenation - if cwd ends with \ and path doesn't start with \
      if (normalizedCwd.endsWith('\\') && !normalizedPath.startsWith('\\')) {
        pathToSend = normalizedCwd + normalizedPath;
      } else if (!normalizedCwd.endsWith('\\') && !normalizedPath.startsWith('\\')) {
        pathToSend = normalizedCwd + '\\' + normalizedPath;
      } else {
        pathToSend = normalizedCwd + normalizedPath;
      }

      console.log('[TerminalTab] Resolved relative path:', matchedPath, '->', pathToSend, 'using CWD:', cwd);
    }
  }

  // Set validation state
  fileStore.setValidatingPath(pathToSend);

  // Check fileWebSocket state
  const fwsConnected = fileWebSocket.isConnected();

  // Ensure fileWebSocket is connected before sending
  if (!fwsConnected) {
    const apiUrl = settingsStore.settings.apiUrl || '';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = apiUrl
      ? apiUrl.replace(/^http/, 'ws') + '/ws/browser'
      : `${wsProtocol}//${window.location.host}/ws/browser`;


    // Pass agentId to fileWebSocket.connect for proper routing
    fileWebSocket.connect(wsUrl, props.tab.agentId).then(() => {
      fileWebSocket.validatePath(pathToSend, sessionId!);
    }).catch(err => {
      console.error('[TerminalTab] Failed to connect fileWebSocket:', err);
      fileStore.setValidatingPath(null);
    });
  } else {
    fileWebSocket.validatePath(pathToSend, sessionId);
  }
}

// Handle localhost URL click
function handleLocalhostUrlClick(url: string) {
  console.log('[TerminalTab] handleLocalhostUrlClick:', url, 'sessionId:', sessionId);

  if (!sessionId) {
    console.log('[TerminalTab] no sessionId, cannot open WebViewer');
    return;
  }

  // Set WebViewer state
  webViewerStore.setUrl(url);
  webViewerStore.setSessionId(sessionId);
  webViewerStore.setVisible(true);
}

// Handle .html file path click - similar to localhost URL but with file:// protocol
function handleHtmlPathClick(matchedPath: string) {
  console.log('[TerminalTab] handleHtmlPathClick:', matchedPath, 'sessionId:', sessionId);

  if (!sessionId) {
    console.log('[TerminalTab] no sessionId, cannot open WebViewer');
    return;
  }

  let pathToSend = matchedPath;

  // Handle file:// prefix (e.g. file://C:\path\file.html or file:///C:\path\file.html)
  if (/^file:\/\//i.test(matchedPath)) {
    let rawPath = matchedPath.replace(/^file:\/\//i, '');
    // Strip leading slashes (handles both file://C: and file:///C: variants)
    rawPath = rawPath.replace(/^\/+/, '');
    pathToSend = rawPath.replace(/\//g, '\\');
  } else {
    // Parse CWD from terminal buffer for relative paths
    const isAbsolutePath = /^[A-Za-z]:/.test(matchedPath) || /^[.\/]/.test(matchedPath);

    if (!isAbsolutePath) {
      const cwd = parseCwdFromBuffer();
      if (cwd) {
        const normalizedCwd = cwd.replace(/\//g, '\\');
        const normalizedPath = matchedPath.replace(/\//g, '\\');

        if (normalizedCwd.endsWith('\\') && !normalizedPath.startsWith('\\')) {
          pathToSend = normalizedCwd + normalizedPath;
        } else if (!normalizedCwd.endsWith('\\') && !normalizedPath.startsWith('\\')) {
          pathToSend = normalizedCwd + '\\' + normalizedPath;
        } else {
          pathToSend = normalizedCwd + normalizedPath;
        }

        console.log('[TerminalTab] Resolved HTML path:', matchedPath, '->', pathToSend);
      }
    }
  }

  // Convert Windows path to file:// URL format
  // C:\path\to\file.html -> file:///C:/path/to/file.html
  const fileUrl = 'file:///' + pathToSend.replace(/\\/g, '/');
  console.log('[TerminalTab] File URL:', fileUrl);

  // Set WebViewer state
  webViewerStore.setUrl(fileUrl);
  webViewerStore.setSessionId(sessionId);
  webViewerStore.setVisible(true);
}

// Browser visibility change handler (minimize, tab switch, mobile app switch)
let visibilityHandler: (() => void) | null = null;
// [debug-loop] fix v2: Handle bfcache restoration on mobile browsers
// iOS Safari aggressively uses bfcache for back/forward navigation.
// When page is restored, WebSocket is closed but Vue components are NOT
// re-mounted (page state is preserved), so no reconnect happens.
// The pageshow event with persisted=true detects bfcache restoration.
let pageshowHandler: ((e: PageTransitionEvent) => void) | null = null;

onMounted(() => {
  // Register CWD buffer parser so FileView can parse CWD from terminal buffer directly
  terminalStore.registerBufferParser(props.tab.id, parseCwdFromBuffer);
  // Only initialize terminal if this tab is visible
  // If not visible, it will be initialized when it becomes visible
  if (props.visible) {
    initTerminal();
  }

  // Recover Claude Code TUI when browser becomes visible again
  // Covers: browser minimize/restore, mobile app switch away/back, browser tab switch
  visibilityHandler = () => {
    if (!document.hidden && props.visible && terminal && sessionId) {
      sendWideCharRecovery(200);
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // [debug-loop] fix v2: Handle bfcache restoration (mobile Safari)
  // When user navigates away via browser back/forward button and returns,
  // the page may be restored from bfcache. WebSocket is closed but Vue
  // components are NOT re-mounted. Detect this and reconnect.
  pageshowHandler = (event: PageTransitionEvent) => {
    console.log('[TerminalTab][pageshow] persisted:', event.persisted, 'tab:', props.tab.id,
      'ws.readyState:', ws?.readyState, 'sessionId:', props.tab.sessionId || 'none');
    if (event.persisted) {
      // Page was restored from bfcache
      if (props.visible && (!ws || ws.readyState !== WebSocket.OPEN)) {
        console.log('[TerminalTab][pageshow] bfcache restored, reconnecting WebSocket');
        connectWebSocket();
      } else if (props.visible && terminal && sessionId) {
        // WebSocket is open but page was restored - refresh terminal
        console.log('[TerminalTab][pageshow] bfcache restored, WS open, sending recovery');
        sendWideCharRecovery(200);
      }
    }
  };
  window.addEventListener('pageshow', pageshowHandler);
});

onUnmounted(() => {
  terminalStore.unregisterBufferParser(props.tab.id);
  terminalStore.unregisterKeySender(props.tab.id);
  terminalStore.unregisterTabFocuser(props.tab.id);
  terminalStore.unregisterTabScroller(props.tab.id);
  terminalStore.unregisterTabFitter(props.tab.id);
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (pageshowHandler) {
    window.removeEventListener('pageshow', pageshowHandler);
    pageshowHandler = null;
  }
  cleanup();
});

// [debug-loop] fix: Extract wide-char recovery as reusable function
// Simulates "Chinese first input" to trigger Claude Code's full layout recalculation
function sendWideCharRecovery(delayMs: number = 600) {
  setTimeout(() => {
    const currentSessionId = props.tab.sessionId;
    if (ws && currentSessionId && ws.readyState === WebSocket.OPEN) {
      // Send wide character to trigger layout recalculation
      ws.send(JSON.stringify({
        type: 'session:input', sessionId: currentSessionId,
        payload: { data: '口' },
        timestamp: Date.now(),
      }));
      // Delete immediately — 100ms is enough for Claude Code to process
      setTimeout(() => {
        if (ws && currentSessionId && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'session:input', sessionId: currentSessionId,
            payload: { data: '\x7f' },
            timestamp: Date.now(),
          }));
        }
      }, 100);
    }
  }, delayMs);
}

watch(() => props.visible, (visible, wasVisible) => {
  blackbox.log('navigation', 'TerminalTab:visible', {
    tabId: props.tab.id?.slice(-6),
    visible, wasVisible,
    terminalInitialized,
    hasTerminal: !!terminal,
  });
  // Initialize terminal when becoming visible for the first time
  if (visible && !terminalInitialized) {
    initTerminal();
    return; // initTerminal will handle the fit and scroll
  }

  // Save scrollback when leaving this tab
  if (wasVisible && !visible) {
    saveScrollback();
  }
  // Fit and scroll to bottom when switching back to this tab
  if (visible && terminal) {
    // Update CWD when switching to this tab
    const cwd = parseCwdFromBuffer();
    if (cwd && !terminalStore.isTabCwdLocked(props.tab.id)) {
      terminalStore.setTabCwd(props.tab.id, cwd);
    }

    // [debug-loop] fix: Send wide-char recovery when switching back to this tab
    // Multi-tab switching doesn't trigger session:resume, but still needs recovery
    // Use shorter delay (200ms) since no bump resize is happening
    sendWideCharRecovery(200);

    // Only ONE safeFit call to prevent multiple rapid resize events
    // that corrupt Claude Code TUI state.
    requestAnimationFrame(() => {
      if (!terminal) return;
      const prevCols = terminal.cols;
      const prevRows = terminal.rows;
      safeFit();

      // [debug-loop] fix: After safeFit, xterm might not re-render if dimensions
      // didn't change (e.g., when switching back from file manager with same viewport).
      // Force refresh to ensure canvas is properly redrawn on Android Chrome.
      if (terminal.cols === prevCols && terminal.rows === prevRows) {
        try {
          (terminal as any).refresh(0, terminal.rows - 1);
          blackbox.log('fit', 'fitter:refresh', {
            tabId: props.tab.id?.slice(-6),
            cols: terminal.cols, rows: terminal.rows,
            reason: 'visible-switch-no-dim-change',
          });
        } catch { /* refresh might not be available */ }
      }

      requestAnimationFrame(() => {
        if (!terminal) return;
        forceScrollToBottom();
        tryFocus();
      });
    });
  }
});

// Focus terminal when MarkdownViewer closes
watch(() => fileStore.viewerVisible, (visible) => {
  if (!visible && terminal) {
    // Recover Claude Code TUI after file viewer overlay closes
    sendWideCharRecovery(200);
    setTimeout(() => tryFocus(), 100);
  }
});
// Try to focus terminal with retries
function tryFocus(attempts = 0) {
  if (!terminal) return;
  terminal.focus();
  // Check if focus succeeded - xterm uses a textarea internally
  // The active element should be a textarea when terminal is focused
  const activeTag = document.activeElement?.tagName;
  const isTextarea = activeTag === 'TEXTAREA';
  const isBody = activeTag === 'BODY';

  // If focus didn't land on textarea (terminal's input), retry
  // Also retry if focus landed on body (no element focused)
  if ((!isTextarea || isBody) && attempts < 5) {
    setTimeout(() => tryFocus(attempts + 1), 50);
  }
}

// Force scroll to bottom using multiple methods for reliability
function forceScrollToBottom() {
  if (!terminal || !terminalRef.value) return;

  // Reset user scroll flag since we're forcing to bottom
  userScrolledUp = false;

  // Method 1: Use xterm's scrollToBottom (most reliable)
  terminal.scrollToBottom();

  // Method 2: Directly manipulate the viewport element
  // This ensures the viewport scrollTop is at maximum
  const viewport = terminalRef.value.querySelector('.xterm-viewport') as HTMLElement;
  if (viewport) {
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  }
}

// Build a mapping from string index to cell position for a terminal line.
// translateToString(true) skips trail cells of fullwidth characters (e.g., Chinese),
// so string index != cell position when fullwidth chars are present.
// Returns an array where result[strIdx] = cellPos.
function buildStringToCellMap(line: any, lineText: string): number[] {
  const map: number[] = [];
  let cellPos = 0;
  for (let strIdx = 0; strIdx < lineText.length; strIdx++) {
    map[strIdx] = cellPos;
    const cell = line.getCell(cellPos);
    if (!cell) break;
    const w = cell.getWidth();
    // Fullwidth chars (w=2) occupy 2 cells but 1 string position
    // Normal chars (w=1) occupy 1 cell and 1 string position
    // Trail cells (w=0) are skipped by translateToString
    cellPos += (w > 0) ? w : 1;
  }
  // Add sentinel for end-of-string → cell position
  map[lineText.length] = cellPos;
  return map;
}

// Check if terminal is scrolled to bottom
function isScrolledToBottom(): boolean {
  if (!terminal) return true;
  const buffer = terminal.buffer.active;
  // Check if viewport is at the bottom
  return buffer.viewportY >= buffer.length - terminal.rows - 1;
}

// Setup scroll tracking on the viewport
function setupScrollTracking() {
  if (!terminalRef.value) return;

  const viewport = terminalRef.value.querySelector('.xterm-viewport') as HTMLElement;
  if (!viewport) return;

  viewport.addEventListener('scroll', () => {
    // Track if user scrolled up from bottom
    userScrolledUp = !isScrolledToBottom();
  }, { passive: true });
}

// Safely fit terminal - only when tab is visible and container has valid size
function safeFit() {
  safeFitStats.calls++;
  if (!props.visible || !terminal || !fitAddon || !terminalRef.value) {
    safeFitStats.skipped++;
    (window as any).__safeFitStats = { ...safeFitStats, reason: !props.visible ? 'notVisible' : !terminal ? 'noTerminal' : !fitAddon ? 'noFitAddon' : 'noRef' };
    return;
  }

  const rect = terminalRef.value.getBoundingClientRect();
  safeFitStats.lastRectH = Math.round(rect.height);
  if (rect.width <= 0 || rect.height <= 0) {
    safeFitStats.skipped++;
    (window as any).__safeFitStats = { ...safeFitStats, reason: 'zeroRect' };
    console.log('[TerminalTab][safeFit] SKIPPED: rect is zero/negative',
      JSON.stringify({ w: rect.width, h: rect.height }),
      'visible:', props.visible, 'innerHeight:', window.innerHeight);
    return;
  }

  // [debug-loop] Log fit dimensions
  console.log('[TerminalTab][safeFit] fitting:',
    JSON.stringify({ w: rect.width, h: rect.height }),
    'xterm before:', terminal.cols, 'x', terminal.rows,
    'innerHeight:', window.innerHeight);
  shouldSendResize = true;
  const prevCols = terminal.cols;
  const prevRows = terminal.rows;
  fitAddon.fit();
  safeFitStats.fitted++;
  safeFitStats.lastCols = terminal.cols;
  safeFitStats.lastRows = terminal.rows;
  (window as any).__safeFitStats = { ...safeFitStats, reason: 'ok' };
  blackbox.log('fit', 'safeFit:done', {
    tabId: props.tab.id?.slice(-6),
    rectW: Math.round(rect.width), rectH: Math.round(rect.height),
    beforeCols: prevCols, beforeRows: prevRows,
    afterCols: terminal.cols, afterRows: terminal.rows,
    changed: prevCols !== terminal.cols || prevRows !== terminal.rows,
  });
  console.log('[TerminalTab][safeFit] after fit: xterm', terminal.cols, 'x', terminal.rows);
}

function initTerminal() {
  if (!terminalRef.value) return;

  terminalInitialized = true;
  console.log(`[TerminalTab] Initializing terminal for ${props.tab.id}`);

  // [debug-loop] fix: convertEol=true converts bare \n to \r\n.
  // Claude Code CLI uses ANSI escape sequences with bare \n (no \r),
  // causing stairstep rendering corruption in xterm.js (which defaults to convertEol=false).
  // PowerShell uses Windows console APIs → ConPTY converts \n to \r\n → not affected.
  terminal = new Terminal({
    convertEol: true,
    fontFamily: settingsStore.settings.fontFamily,
    fontSize: settingsStore.settings.fontSize,
    theme: {
      background: '#0f0f23',
      foreground: '#e8e8f0',
      cursor: '#e94560',
      cursorAccent: '#0f0f23',
      selectionBackground: 'rgba(233, 69, 96, 0.3)',
      black: '#2d2d3f',
      red: '#e94560',
      green: '#4caf50',
      yellow: '#ff9800',
      blue: '#4fc3f7',
      magenta: '#7b1fa2',
      cyan: '#00bcd4',
      white: '#e8e8f0',
      brightBlack: '#4a4a5e',
      brightRed: '#ff6b8a',
      brightGreen: '#66bb6a',
      brightYellow: '#ffa726',
      brightBlue: '#81d4fa',
      brightMagenta: '#ab47bc',
      brightCyan: '#26c6da',
      brightWhite: '#ffffff',
    },
    scrollback: 10000,
    scrollSensitivity: 30,
  });

  fitAddon = new FitAddon();
  serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);

  // [debug-loop] fix v3: Open terminal hidden, reveal after keyboard settles.
  //
  // Root cause (from blackbox data):
  // - v2 waited for viewport stability BEFORE terminal.open(), but the keyboard
  //   opens ~600ms after mount (triggered by tryFocus). The 300ms wait was not
  //   long enough — it detected "stable" innerHeight before the keyboard opened,
  //   then terminal.open() was still called at the wrong (large) size.
  //
  // New approach:
  // 1. Open terminal IMMEDIATELY (hidden with opacity:0)
  // 2. Watch innerHeight for keyboard-open detection (drop of >50px)
  // 3. After keyboard detected + settled (3 stable readings), reveal terminal
  // 4. If no keyboard after 2s, reveal anyway (desktop/no-keyboard case)
  //
  // This guarantees xterm canvas is created at the FINAL correct size,
  // avoiding the Android Chrome canvas re-render bug entirely.
  blackbox.log('terminal', 'waitingForContainer', {
    tabId: props.tab.id?.slice(-6),
    innerH: window.innerHeight,
    vvHeight: window.visualViewport?.height,
  });
  const waitForContainerAndOpen = (attempt: number = 0) => {
    if (!terminalRef.value) {
      if (attempt < 30) {
        setTimeout(() => waitForContainerAndOpen(attempt + 1), 50);
      } else {
        blackbox.log('terminal', 'openTimeout', { tabId: props.tab.id?.slice(-6), attempt });
        terminal!.open(terminalRef.value!);
        onTerminalOpened();
      }
      return;
    }
    const rect = terminalRef.value.getBoundingClientRect();
    if (rect.height <= 0 && attempt < 30) {
      setTimeout(() => waitForContainerAndOpen(attempt + 1), 50);
      return;
    }

    blackbox.log('terminal', 'containerReady', {
      tabId: props.tab.id?.slice(-6),
      attempt, rectW: Math.round(rect.width), rectH: Math.round(rect.height),
    });

    // Hide terminal wrapper BEFORE opening — prevents flash of incorrectly-sized content
    const wrapper = terminalRef.value?.closest('.terminal-wrapper') as HTMLElement | null;
    if (wrapper) {
      wrapper.style.opacity = '0';
    }

    // Open terminal immediately (hidden). The canvas initializes at current container size.
    terminal!.open(terminalRef.value!);
    onTerminalOpened();

    // Now watch for keyboard: innerHeight will drop when keyboard opens.
    // After it settles, we know the final viewport size and can reveal correctly.
    const initialH = window.innerHeight;
    let keyboardDetected = false;
    let stableCount = 0;
    let lastH = initialH;
    let checkAttempts = 0;
    let revealed = false;

    const revealTerminal = (reason: string) => {
      if (revealed) return;
      revealed = true;
      if (wrapper) {
        wrapper.style.opacity = '';
      }
      blackbox.log('terminal', 'revealed', {
        tabId: props.tab.id?.slice(-6),
        innerH: window.innerHeight,
        vvHeight: window.visualViewport?.height,
        keyboardDetected,
        reason,
        checkAttempts,
      });
      // Final fit at revealed dimensions (keyboard has settled)
      safeFit();
      try { (terminal! as any).refresh(0, terminal!.rows - 1); } catch { }

      // Delayed second refresh to ensure canvas is fully rendered.
      // On Android Chrome with heavy pages (md-editor-v3 etc.), xterm's canvas
      // renderer may need extra time after terminal.open() to initialize.
      // The immediate refresh() above may fire before the renderer is ready.
      // A delayed refresh after a few animation frames catches the renderer when ready.
      setTimeout(() => {
        try { (terminal! as any).refresh(0, terminal!.rows - 1); } catch { }
      }, 200);

      // NOW connect WebSocket and focus — terminal is at correct final size
      connectWebSocket();
      setTimeout(() => {
        console.log('[TerminalTab][focus] attempting focus after reveal');
        tryFocus();
      }, 100);
    };

    const checkKeyboard = () => {
      if (revealed) return;
      checkAttempts++;
      const currentH = window.innerHeight;

      if (Math.abs(currentH - initialH) > 50) {
        keyboardDetected = true;
      }

      if (keyboardDetected) {
        // Keyboard opened — wait for it to settle (animation complete)
        if (Math.abs(currentH - lastH) <= 2) {
          stableCount++;
        } else {
          stableCount = 0;
          lastH = currentH;
        }
        if (stableCount >= 5) {
          revealTerminal('keyboard-settled');
          return;
        }
      }

      // Timeout: if no keyboard after 1500ms, reveal anyway
      // (Android keyboard takes ~300-500ms to open; desktop has no keyboard.
      //  Increased from 500ms to 1500ms to account for heavier page loads
      //  from new file management views with md-editor-v3.)
      if (checkAttempts >= 15) {
        revealTerminal('timeout');
        return;
      }

      setTimeout(checkKeyboard, 100);
    };

    setTimeout(checkKeyboard, 100);
  };

  function onTerminalOpened() {
    blackbox.log('terminal', 'opened', {
      tabId: props.tab.id?.slice(-6),
      cols: terminal!.cols, rows: terminal!.rows,
      innerH: window.innerHeight,
      vvHeight: window.visualViewport?.height,
      containerRect: terminalRef.value ? JSON.stringify({
        w: Math.round(terminalRef.value.getBoundingClientRect().width),
        h: Math.round(terminalRef.value.getBoundingClientRect().height),
      }) : 'null',
    });

    // Initial fit (will be re-done after reveal when keyboard has settled)
    safeFit();

    // Attach terminal instance to DOM for external access
    if (terminalRef.value) {
      (terminalRef.value as any).__xterm = terminal;
    }

    // Restore scrollback from sessionStorage (at correct dimensions after reveal)
    const savedScrollback = sessionStorage.getItem(`scrollback:${props.tab.id}`);
    if (savedScrollback && terminal) {
      terminal.write(savedScrollback);
    }

    // NOTE: connectWebSocket() and tryFocus() are deferred to revealTerminal()
    // which fires after keyboard has settled. This ensures session:resume
    // is sent with the correct terminal dimensions.
  }

  waitForContainerAndOpen();

  // Helper: check if charBefore is a valid path separator
  // Special handling for colon: if the matched part starts with [A-Za-z]: (Windows drive),
  // then the preceding colon is a separator and we should keep the drive letter.
  function isPathSeparator(charBefore: string, matchedPart: string): boolean {
    if (charBefore === ' ' || charBefore === '"' || charBefore === "'" || charBefore === '`') {
      return true;
    }
    if (charBefore === ':' || charBefore === '：') {
      // Check if matchedPart starts with Windows drive letter (e.g., "D:")
      // If so, the preceding colon is a separator (e.g., ":D:\path")
      // If not, the colon might be part of the path, continue looking
      if (/^[A-Za-z]:/.test(matchedPart)) {
        return true; // Preceding colon is separator, keep the drive
      }
      return false; // Colon might be part of path, continue looking back
    }
    return false;
  }

  // Register link provider for .md file paths (xterm v5 API)
  terminal.registerLinkProvider({
    provideLinks(bufferLineNumber: number, callback: (links: any[] | undefined) => void) {
      try {
        const buffer = terminal!.buffer.active;
        const line = buffer.getLine(bufferLineNumber - 1);  // bufferLineNumber is 1-based from xterm, getLine needs 0-based
        if (!line) {
          callback(undefined);
          return;
        }

        const lineText = line.translateToString(true);
        if (!lineText) {
          callback(undefined);
          return;
        }

        // Build string-index → cell-position mapping (handles fullwidth chars like Chinese)
        const strToCell = buildStringToCellMap(line, lineText);

        const foundLinks: any[] = [];

        // Match .md file paths (Windows absolute, relative, Unix-style, bare filenames)
        // Handles: quoted paths, colon prefix (:file.md), trailing punctuation
        // Note: '-' must be at start of character class to avoid range interpretation
        const mdRegex = /(["'])([-a-zA-Z0-9_\u4e00-\u9fff. \\\/]+\.md)\1|([A-Za-z]:[\\\/][^\s"'<>]*\.md)|([-a-zA-Z0-9_\u4e00-\u9fff.]+[\\\/][^\s"'<>]*\.md)|(?:^|(?<=\s)|(?<=:)|(?<=：)|(?<=\())([-\w\u4e00-\u9fff.]+\.md)(?=\s|$|[,;.!?(){}\]\u3002\uff0c\uff01\uff1f\u300b>])/g;
        let matchResult;

        while ((matchResult = mdRegex.exec(lineText)) !== null) {
          // Extract file path from the appropriate capture group.
          // Groups: 2=quoted, 3=Windows abs, 4=Unix/rel, 5=bare filename
          const filePath = matchResult[2] || matchResult[3] || matchResult[4] || matchResult[5];
          if (!filePath) continue;

          const matchedText = matchResult[0];
          const matchStart = matchResult.index;
          const matchEnd = matchStart + matchedText.length;

          // Heuristic: if quoted match contains multiple .md extensions,
          // it's likely multiple files, not one file with spaces.
          // Split into individual file matches using bare filename regex.
          if (matchResult[2]) {
            const mdCount = (filePath.match(/\.md/gi) || []).length;
            if (mdCount > 1) {
              // Re-match individual files within the quoted content
              const innerBareRegex = /[-a-zA-Z0-9_一-鿿.]+\.md/g;
              let innerMatch;
              while ((innerMatch = innerBareRegex.exec(filePath)) !== null) {
                const innerPath = innerMatch[0];
                const innerStrStart = matchResult.index + 1 + innerMatch.index; // +1 for quote
                const innerStrEnd = innerStrStart + innerPath.length;
                const innerCellStart = strToCell[innerStrStart] ?? innerStrStart;
                const innerCellEnd = strToCell[innerStrEnd] ?? innerStrEnd;

                foundLinks.push({
                  range: {
                    start: { x: innerCellStart, y: bufferLineNumber },
                    end: { x: innerCellEnd, y: bufferLineNumber },
                  },
                  text: innerPath,
                  decorations: { underline: true, pointerCursor: true },
                  activate() { handleMdPathClick(innerPath); },
                });
              }
              continue; // Skip the original quoted match
            }
          }

          // Try to build complete path by looking at previous lines
          let completePath = filePath;

          // Check if this might be a continuation of a previous line's path
          // (path doesn't start with drive letter or ./ or /)
          const isAbsolutePath = /^[A-Za-z]:/.test(filePath) || /^[.\/]/.test(filePath);

          // Always try to look back for path prefix if not an absolute path
          // For relative paths, trace back through soft-wrapped lines
          if (!isAbsolutePath) {
            console.log('[MD LinkProvider] Relative path detected, looking back for prefix...');
            let lookbackLine = bufferLineNumber - 2;  // prev line in 0-based: bufferLineNumber is 1-based, prev = -2
            let pathPrefix = '';

            while (lookbackLine >= 0) {
              const prevLine = buffer.getLine(lookbackLine);
              if (!prevLine) {
                console.log('[MD LinkProvider] No prevLine at', lookbackLine);
                break;
              }

              const prevText = prevLine.translateToString(true); // Trim right whitespace to handle echo commands

              // Find path chars at end of line
              const pathEndMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);

              if (pathEndMatch) {
                const endPart = pathEndMatch[1];
                const endIndex = pathEndMatch.index ?? 0;
                console.log('[MD LinkProvider] Found pathEndMatch:', endPart, 'at index', endIndex);

                // [debug-loop] fix: If the previous line's end already has a file extension
                // (e.g., "pnpm-workspace.yaml"), it's a complete separate file in a directory listing,
                // not a directory path prefix for the current file. Skip concatenation.
                // Exception: if it ends with .md, it could be a soft-wrapped .md path that we need
                // to continue building (handled by the cross-line detection below, not here).
                const prevHasFileExtension = /\.[a-zA-Z0-9]{1,10}$/.test(endPart) && !endPart.endsWith('.md');
                if (prevHasFileExtension) {
                  console.log('[MD LinkProvider] Previous line end has file extension, skipping lookback (separate file listing)');
                  break;
                }

                // Check if there's a separator before the path chars
                if (endIndex > 0) {
                  const charBefore = prevText[endIndex - 1];
                  console.log('[MD LinkProvider] charBefore:', charBefore);
                  if (isPathSeparator(charBefore, endPart)) {
                    // Found separator - this is the start of the path
                    // [debug-loop] fix: Ensure path separator between endPart and filePath
                    // If endPart doesn't end with \ or /, add one
                    const needsSep = !/[\\\/]$/.test(endPart);
                    const separator = needsSep ? '\\' : '';
                    pathPrefix = endPart + pathPrefix;
                    completePath = pathPrefix + separator + filePath;
                    console.log('[debug-loop] fix: Found separator, complete path:', completePath);
                    break;
                  }
                }

                // No separator - continue building path
                // [debug-loop] fix: If endPart doesn't end with separator, add one
                const needsSep = !/[\\\/]$/.test(endPart);
                const separator = needsSep ? '\\' : '';
                pathPrefix = endPart + separator + pathPrefix;
                console.log('[MD LinkProvider] No separator, continuing. pathPrefix now:', pathPrefix);
                lookbackLine--;
              } else {
                // No path chars at end of line - stop looking
                console.log('[MD LinkProvider] No path chars at end of line, stopping');
                break;
              }
            }

            // If we collected a prefix but didn't set completePath, use it
            if (pathPrefix && completePath === filePath) {
              completePath = pathPrefix + filePath;
              console.log('[MD LinkProvider] Using collected prefix, complete path:', completePath);
            }
          }

          // 调试：输出匹配结果
          console.log('[MD LinkProvider] Found match:', filePath, 'completePath:', completePath, 'at bufferLineNumber', bufferLineNumber);
          console.log('[MD LinkProvider] Creating link with y = bufferLineNumber =', bufferLineNumber);

          // Convert string indices to cell positions (handles fullwidth chars like Chinese)
          const cellStart = strToCell[matchStart] ?? matchStart;
          const cellEnd = strToCell[matchEnd] ?? matchEnd;

          foundLinks.push({
            range: {
              start: { x: cellStart, y: bufferLineNumber },
              end: { x: cellEnd, y: bufferLineNumber },
            },
            text: matchedText,
            decorations: {
              underline: true,
              pointerCursor: true,
            },
            activate(_event: MouseEvent, _text: string) {
              handleMdPathClick(completePath);
            },
          });
        }

        // Check if this line STARTS with a continuation of .md from previous line
        // E.g., line is "d rest..." or "md rest..." after "file.m" or "file." on previous line
        // Note: We don't rely on isWrapped because it may be false even for visually wrapped lines
        console.log('[MD LinkProvider] Line', bufferLineNumber, 'isWrapped:', line.isWrapped, 'text:', lineText.substring(0, 30));
        if (foundLinks.length === 0) {
          const continuationMatch = lineText.match(/^\s*(\.md|md|d)(?:\s|$|[,.:;!?)}\]])/);
          console.log('[MD LinkProvider] continuationMatch:', continuationMatch);
          if (continuationMatch) {
            const suffixPart = continuationMatch[1];
            // Find actual position of suffixPart in lineText (account for leading whitespace)
            const suffixStart = lineText.indexOf(suffixPart);

            // Look back at previous line for the path prefix
            const prevLineNum = bufferLineNumber - 2;  // prev line in 0-based: bufferLineNumber is 1-based, prev = -2
            const prevLine = buffer.getLine(prevLineNum);
            if (prevLine) {
              const prevText = prevLine.translateToString(true);
              // Check if previous line ends with path chars that could form .md with this suffix
              // Include colon for Windows drive letters (D:), trim leading whitespace
              const prevEndMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/\u4e00-\u9fff ]+)$/);
              if (prevEndMatch) {
                const prevPart = prevEndMatch[1].trimStart();
                const combined = (prevPart + suffixPart).trim();
                // Check if combined forms a valid .md path
                if (combined.endsWith('.md') && /[-a-zA-Z0-9_:.\\\/\u4e00-\u9fff]+\.md$/.test(combined)) {
                  let completePath = combined;

                  // Continue looking back for more path prefix
                  let lookbackLine = prevLineNum - 1;
                  let pathPrefix = '';
                  const isFirstPartAbsolute = /^[A-Za-z]:/.test(prevPart.trim()) || /^[.\/]/.test(prevPart.trim());

                  if (!isFirstPartAbsolute) {
                    while (lookbackLine >= 0) {
                      const lbLine = buffer.getLine(lookbackLine);
                      if (!lbLine) break;
                      const lbText = lbLine.translateToString(true);
                      const lbMatch = lbText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);
                      if (lbMatch) {
                        const lbPart = lbMatch[1];
                        const lbIndex = lbMatch.index ?? 0;
                        if (lbIndex > 0) {
                          const charBefore = lbText[lbIndex - 1];
                          if (isPathSeparator(charBefore, lbPart)) {
                            pathPrefix = lbPart + pathPrefix;
                            completePath = pathPrefix + completePath;
                            break;
                          }
                        }
                        pathPrefix = lbPart + pathPrefix;
                        lookbackLine--;
                      } else {
                        break;
                      }
                    }
                    if (pathPrefix && completePath === combined) {
                      completePath = pathPrefix + completePath;
                    }
                  }

                  console.log('[MD LinkProvider] Reverse cross-line found:', completePath);
                  // Extend link range to end of line to make it easier to click
                  const lineLength = lineText.length;
                  console.log('[MD LinkProvider] Reverse link coords: x:', suffixStart + 1, 'to', lineLength, 'y:', bufferLineNumber, 'suffixPart:', suffixPart);

                  const suffixCellStart = strToCell[suffixStart] ?? suffixStart;
                  const lineLengthCell = strToCell[lineText.length] ?? lineText.length;

                  foundLinks.push({
                    range: {
                      start: { x: suffixCellStart, y: bufferLineNumber },
                      end: { x: lineLengthCell, y: bufferLineNumber },
                    },
                    text: lineText.substring(suffixStart), // Include trailing whitespace
                    decorations: { underline: true, pointerCursor: true },
                    activate() {
                      console.log('[MD LinkProvider] activate suffix link for:', completePath);
                      handleMdPathClick(completePath);
                    },
                  });
                }
              }
            }
          }
        }

        // Also check for path continuations (line ending with path chars that continue to .md on next line)
        const pathEndRegex = /[-a-zA-Z0-9_:.\\\/]+$/;
        const pathEndMatch = lineText.match(pathEndRegex);

        if (pathEndMatch && foundLinks.length === 0) {
          const matchedEnd = pathEndMatch[0];
          const matchStart = lineText.length - matchedEnd.length;

          // Check next lines for .md
          let lookAheadLine = bufferLineNumber;  // next line in 0-based: bufferLineNumber is 1-based, next = +0

          for (let i = 0; i < 3; i++) {
            const nextLine = buffer.getLine(lookAheadLine);
            if (!nextLine) break;

            const nextText = nextLine.translateToString(true);

            // Check if next line starts with path chars and has .md (or continuation like 'd', 'md')
            // Handles cases where '.md' is split: 'file.m' on one line, 'd' on next
            // Allow leading whitespace
            const mdMatch = nextText.match(/^\s*(?:[-a-zA-Z0-9_:.\\\/]*\.md|md|d)(?:\s|$|[,.:;!?)}\]])/)
              || nextText.match(/^\s*(?:[-a-zA-Z0-9_:.\\\/]*\.md|md|d)$/);
            if (mdMatch && (mdMatch[0].endsWith('.md') || mdMatch[0].trim() === 'd' || mdMatch[0].trim() === 'md' || /\.m?$/.test(matchedEnd))) {
              const pathSuffix = mdMatch[0].trim();

              // Build complete path
              let completePath = matchedEnd + pathSuffix;

              // Look back for path prefix
              let lookbackLine = bufferLineNumber - 2;  // prev line in 0-based: bufferLineNumber is 1-based, prev = -2
              let pathPrefix = '';

              const isFirstPartAbsolute = /^[A-Za-z]:/.test(matchedEnd) || /^[.\/]/.test(matchedEnd);

              if (!isFirstPartAbsolute) {
                while (lookbackLine >= 0) {
                  const prevLine = buffer.getLine(lookbackLine);
                  if (!prevLine) break;

                  const prevText = prevLine.translateToString(false);

                  const prevMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);

                  if (prevMatch) {
                    const endPart = prevMatch[1];
                    const endIndex = prevMatch.index ?? 0;

                    // Check if there's a separator before the path chars
                    if (endIndex > 0) {
                      const charBefore = prevText[endIndex - 1];
                      if (isPathSeparator(charBefore, endPart)) {
                        // Found separator - this is the start of the path
                        pathPrefix = endPart + pathPrefix;
                        completePath = pathPrefix + completePath;
                        break;
                      }
                    }

                    // No separator - continue building path
                    pathPrefix = endPart + pathPrefix;
                    lookbackLine--;
                  } else {
                    break;
                  }
                }

                // If we collected a prefix but didn't set completePath, use it
                if (pathPrefix && completePath === matchedEnd + pathSuffix) {
                  completePath = pathPrefix + completePath;
                }
              }

              console.log('[MD LinkProvider] Cross-line path found:', completePath);
              console.log('[MD LinkProvider] Forward link coords: x:', matchStart + 1, 'to', lineText.length, 'y:', bufferLineNumber);

              // Create link for the current line portion (the prefix part ending with '.m' or similar)
              const crossCellStart = strToCell[matchStart] ?? matchStart;
              const crossLineLengthCell = strToCell[lineText.length] ?? lineText.length;
              foundLinks.push({
                range: {
                  start: { x: crossCellStart, y: bufferLineNumber },
                  end: { x: crossLineLengthCell, y: bufferLineNumber },
                },
                text: matchedEnd,
                decorations: {
                  underline: true,
                  pointerCursor: true,
                },
                activate(_event: MouseEvent, _text: string) {
                  console.log('[MD LinkProvider] activate cross-line for:', completePath);
                  handleMdPathClick(completePath);
                },
              });
              // Note: We don't create link for next line here because provideLinks
              // is called per-line. The next line's link will be created when
              // provideLinks is called for that line (via reverse detection).
              break;
            }

            // Check if next line has path chars but no .md yet - continue looking
            const pathContMatch = nextText.match(/^\s*[-a-zA-Z0-9_:.\\\/]+/);
            if (pathContMatch) {
              lookAheadLine++;
            } else {
              break;
            }
          }
        }

        // Localhost URL detection
        const urlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1)(?:\:\d+)?(?:[\/\?#][^\s]*)?/g;
        let urlMatch;

        while ((urlMatch = urlRegex.exec(lineText)) !== null) {
          const matchedUrl = urlMatch[0];
          const matchStart = urlMatch.index;
          const matchEnd = matchStart + matchedUrl.length;

          const urlCellStart = strToCell[matchStart] ?? matchStart;
          const urlCellEnd = strToCell[matchEnd] ?? matchEnd;
          foundLinks.push({
            range: {
              start: { x: urlCellStart, y: bufferLineNumber },
              end: { x: urlCellEnd, y: bufferLineNumber },
            },
            text: matchedUrl,
            decorations: {
              underline: true,
              pointerCursor: true,
            },
            activate(_event: MouseEvent, _text: string) {
              handleLocalhostUrlClick(matchedUrl);
            },
          });
        }

        // file:// URL detection
        // Skip URLs that reach the end of the line (likely wrapped) — let DirectClick handle those
        const fileUrlRegex = /file:\/\/([A-Za-z]:[^\s"'<>]+)/g;
        let fileUrlMatch;

        while ((fileUrlMatch = fileUrlRegex.exec(lineText)) !== null) {
          const matchedFileUrl = fileUrlMatch[0];
          const matchStart = fileUrlMatch.index;
          const matchEnd = matchStart + matchedFileUrl.length;

          // If URL reaches near end of line, it likely wraps — skip LinkProvider for it
          // DirectClick handler will handle the full URL reconstruction
          if (matchEnd >= terminal!.cols - 2 || matchEnd >= lineText.length - 2) continue;

          const fileUrlCellStart = strToCell[matchStart] ?? matchStart;
          const fileUrlCellEnd = strToCell[matchEnd] ?? matchEnd;
          foundLinks.push({
            range: {
              start: { x: fileUrlCellStart, y: bufferLineNumber },
              end: { x: fileUrlCellEnd, y: bufferLineNumber },
            },
            text: matchedFileUrl,
            decorations: {
              underline: true,
              pointerCursor: true,
            },
            activate(_event: MouseEvent, _text: string) {
              handleHtmlPathClick(matchedFileUrl);
            },
          });
        }

        // HTML file detection
        const htmlRegex = /[-a-zA-Z0-9_:.\\\/]+\.html?/g;
        let htmlMatch;

        while ((htmlMatch = htmlRegex.exec(lineText)) !== null) {
          const matchedPath = htmlMatch[0];
          const matchStart = htmlMatch.index;
          const matchEnd = matchStart + matchedPath.length;

          // Try to build complete path by looking at previous lines (same logic as .md files)
          let completePath = matchedPath;
          const isAbsolutePath = /^[A-Za-z]:/.test(matchedPath) || /^[.\/]/.test(matchedPath);

          if (!isAbsolutePath) {
            let lookbackLine = bufferLineNumber - 2;  // prev line in 0-based: bufferLineNumber is 1-based, prev = -2
            let pathPrefix = '';

            while (lookbackLine >= 0) {
              const prevLine = buffer.getLine(lookbackLine);
              if (!prevLine) break;

              const prevText = prevLine.translateToString(true);
              const pathEndMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);

              if (pathEndMatch) {
                const endPart = pathEndMatch[1];
                const endIndex = pathEndMatch.index ?? 0;

                if (endIndex > 0) {
                  const charBefore = prevText[endIndex - 1];
                  if (isPathSeparator(charBefore, endPart)) {
                    pathPrefix = endPart + pathPrefix;
                    completePath = pathPrefix + matchedPath;
                    break;
                  }
                }

                pathPrefix = endPart + pathPrefix;
                lookbackLine--;
              } else {
                break;
              }
            }

            if (pathPrefix && completePath === matchedPath) {
              completePath = pathPrefix + matchedPath;
            }
          }

          const htmlCellStart = strToCell[matchStart] ?? matchStart;
          const htmlCellEnd = strToCell[matchEnd] ?? matchEnd;
          foundLinks.push({
            range: {
              start: { x: htmlCellStart, y: bufferLineNumber },
              end: { x: htmlCellEnd, y: bufferLineNumber },
            },
            text: matchedPath,
            decorations: {
              underline: true,
              pointerCursor: true,
            },
            activate(_event: MouseEvent, _text: string) {
              handleHtmlPathClick(completePath);
            },
          });
        }

        if (foundLinks.length > 0) {
          console.log('[MD LinkProvider] Returning', foundLinks.length, 'links for line', bufferLineNumber);
        }
        callback(foundLinks.length > 0 ? foundLinks : undefined);
      } catch (err) {
        console.error('[MD LinkProvider] Error:', err);
        callback(undefined);
      }
    },
  });

  // Direct click detection on terminal (fallback for coordinate issues)
  terminalRef.value?.addEventListener('click', (e: MouseEvent) => {
    if (!terminal) return;

    // Get cell size using xterm.js internal measurements
    const cols = terminal.cols;
    const rows = terminal.rows;

    // Use .xterm-screen for positioning - this is where text is rendered
    const screenEl = terminalRef.value?.querySelector('.xterm-screen') as HTMLElement;
    if (!screenEl) return;

    // Get the actual rendered text area dimensions
    // Use xterm's internal css.canvas.width (excludes scrollbar) instead of screenRect.width
    const xtermCellWidth = (terminal as any)._core?._renderService?.dimensions?.css?.cell?.width;
    const xtermCellHeight = (terminal as any)._core?._renderService?.dimensions?.css?.cell?.height;

    const screenRect = screenEl.getBoundingClientRect();
    // Fallback to screenRect if xterm internals unavailable
    const cellWidth = xtermCellWidth || screenRect.width / cols;
    const cellHeight = xtermCellHeight || screenRect.height / rows;

    // Calculate click position relative to screen element
    // Browser truncates MouseEvent.clientX to integer, causing up to 1-pixel error.
    // Use Math.floor for 0-based column. Match checks use 1-column left tolerance
    // to compensate for truncation at cell boundaries.
    const relX = e.clientX - screenRect.left;
    const relY = e.clientY - screenRect.top;
    const x = Math.floor(relX / cellWidth);
    const y = Math.floor(relY / cellHeight);

    // Boundary check
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;

    // Get buffer line - need to account for the scroll position
    const buffer = terminal.buffer.active;
    const baseY = buffer.baseY;  // How many lines are scrolled up
    const bufferLine = y + baseY;  // Convert screen Y to buffer Y
    const line = buffer.getLine(bufferLine);

    console.log('[DirectClick] x:', x, 'y:', y, 'bufferLine:', bufferLine);

    if (!line) {
      return;
    }

    const lineText = line.translateToString(true);

    // Build string-index → cell-position mapping (handles fullwidth chars like Chinese)
    const strToCell = buildStringToCellMap(line, lineText);

    // Check if click is on a .md file (Windows absolute, relative, Unix-style)
    const mdRegex = /[-a-zA-Z0-9_:.\\\/]+\.md/g;
    let match;
    while ((match = mdRegex.exec(lineText)) !== null) {
      const matchedPath = match[0];
      const matchStart = match.index;
      const matchEnd = matchStart + matchedPath.length;
      // Convert string indices to cell positions for comparison with click coordinate x
      const cellStart = strToCell[matchStart] ?? matchStart;
      const cellEnd = strToCell[matchEnd] ?? matchEnd;
      console.log('[DirectClick] mdRegex match:', JSON.stringify(matchedPath), 'cellStart:', cellStart, 'cellEnd:', cellEnd, 'x:', x);

      // Check if click is within this match (x is 0-based cell position)
      // Allow 1-column left tolerance to compensate for browser integer truncation of clientX
      if (x >= cellStart - 1 && x < cellEnd) {
        // Try to build complete path for multi-line paths
        let completePath = matchedPath;
        const isAbsolutePath = /^[A-Za-z]:/.test(matchedPath) || /^[.\/]/.test(matchedPath);

        // Always try to look back for path prefix if not an absolute path
        // For relative paths, trace back through soft-wrapped lines
        if (!isAbsolutePath) {
          let lookbackLine = bufferLine - 1;
          let pathPrefix = '';

          while (lookbackLine >= 0) {
            const prevLine = buffer.getLine(lookbackLine);
            if (!prevLine) break;

            const prevText = prevLine.translateToString(false);

            // Find path chars at end of line
            const pathEndMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);

            if (pathEndMatch) {
              const endPart = pathEndMatch[1];
              const endIndex = pathEndMatch.index ?? 0;

              // Check if there's a separator before the path chars
              if (endIndex > 0) {
                const charBefore = prevText[endIndex - 1];
                if (isPathSeparator(charBefore, endPart)) {
                  // Found separator - this is the start of the path
                  pathPrefix = endPart + pathPrefix;
                  completePath = pathPrefix + matchedPath;
                  break;
                }
              }

              // No separator - continue building path
              pathPrefix = endPart + pathPrefix;
              lookbackLine--;
            } else {
              break;
            }
          }

          // If we collected a prefix but didn't set completePath, use it
          if (pathPrefix && completePath === matchedPath) {
            completePath = pathPrefix + matchedPath;
          }
        }

        handleMdPathClick(completePath);
        e.stopPropagation();  // Prevent event from bubbling
        return;
      }
    }
    console.log('[DirectClick] mdRegex loop finished, no click inside match');

    // Check if click is on a file:// URL
    // First try precise coordinate matching, then fall back to line-level detection
    // IMPORTANT: Must handle soft-wrapped URLs (mobile viewport)
    const fileUrlRegex = /file:\/\/[A-Za-z]:[^\s"'<>]+/g;
    let fileUrlMatch;
    const fileUrlsOnLine = [];
    while ((fileUrlMatch = fileUrlRegex.exec(lineText)) !== null) {
      let fullUrl = fileUrlMatch[0];
      const matchEnd = fileUrlMatch.index + fullUrl.length;

      // Check if URL appears to be cut off by soft wrap
      // If the match reaches near the end of the terminal width, look at next line(s)
      // IMPORTANT: URL may wrap across multiple lines on narrow mobile screens
      if (matchEnd >= terminal.cols - 2 || matchEnd >= lineText.length - 2) {
        let lookAheadLine = bufferLine + 1;
        while (lookAheadLine < buffer.length) {
          const nextLine = buffer.getLine(lookAheadLine);
          if (!nextLine) break;
          const nextText = nextLine.translateToString(true).trimStart();
          if (!nextText || !/^[A-Za-z0-9_.\\\/-]/.test(nextText)) break;

          // Take first whitespace-delimited chunk from continuation line
          const chunk = nextText.split(/\s+/)[0];
          fullUrl = fullUrl + chunk;

          // If this continuation line also reaches the end, keep looking
          const nextLineLen = nextText.length;
          if (nextLineLen < terminal.cols - 2) break; // Last chunk, stop

          lookAheadLine++;
        }
        console.log('[DirectClick] file:// URL wrapped, reconstructed:', fullUrl);
      }

      fileUrlsOnLine.push({
        url: fullUrl,
        start: strToCell[fileUrlMatch.index] ?? fileUrlMatch.index,
        end: strToCell[matchEnd] ?? matchEnd
      });
    }

    for (const fu of fileUrlsOnLine) {
      console.log('[DirectClick] fileUrlRegex match:', JSON.stringify(fu.url), 'start:', fu.start, 'end:', fu.end, 'clickX:', x, 'cols:', terminal.cols);
      if (x >= fu.start - 1 && x < fu.end) {
        console.log('[DirectClick] Click inside file:// URL, path:', fu.url);
        handleHtmlPathClick(fu.url);
        e.stopPropagation();
        return;
      }
    }

    // Fallback: if the line starts with file:// and the click is anywhere in the text area, trigger it
    // This handles cases where the coordinate calculation overflows the terminal width
    if (fileUrlsOnLine.length > 0 && fileUrlsOnLine[0].start === 0 && x >= 0 && x < terminal.cols + 5) {
      console.log('[DirectClick] Click on file:// URL line (overflow tolerance), path:', fileUrlsOnLine[0].url);
      handleHtmlPathClick(fileUrlsOnLine[0].url);
      e.stopPropagation();
      return;
    }
    console.log('[DirectClick] fileUrlRegex loop finished, no click inside match');

    // Check if click is on an HTML file path (without file:// prefix, and not already part of file://)
    const htmlFileRegex = /(?<!file:\/\/)[-a-zA-Z0-9_:.\\\/]+\.html?/g;
    let htmlFileMatch;
    while ((htmlFileMatch = htmlFileRegex.exec(lineText)) !== null) {
      const matchedPath = htmlFileMatch[0];
      const matchStart = htmlFileMatch.index;
      const matchEnd = matchStart + matchedPath.length;
      const htmlCellStart = strToCell[matchStart] ?? matchStart;
      const htmlCellEnd = strToCell[matchEnd] ?? matchEnd;
      console.log('[DirectClick] htmlFileRegex match:', JSON.stringify(matchedPath), 'cellStart:', htmlCellStart, 'cellEnd:', htmlCellEnd, 'x:', x);
      if (x >= htmlCellStart - 1 && x < htmlCellEnd) {
        // Check if this might be a continuation of a file:// URL from the previous line
        const prevLine = buffer.getLine(bufferLine - 1);
        if (prevLine) {
          const prevText = prevLine.translateToString(true);
          const prevFileUrlMatch = prevText.match(/(file:\/\/[A-Za-z]:[^\s"'<>]*)$/);
          if (prevFileUrlMatch) {
            // Previous line has a file:// URL that was cut off
            const prefix = prevFileUrlMatch[1];
            // Remove any partial overlap: if prev line ends with partial path, don't double-count
            // The previous line's path fragment at end connects to current line's start
            const fullUrl = prefix + matchedPath;
            console.log('[DirectClick] HTML path is continuation of file:// from prev line:', fullUrl);
            handleHtmlPathClick(fullUrl);
            e.stopPropagation();
            return;
          }
        }
        console.log('[DirectClick] Click inside HTML file path:', matchedPath);
        handleHtmlPathClick(matchedPath);
        e.stopPropagation();
        return;
      }
    }
    console.log('[DirectClick] htmlFileRegex loop finished, no click inside match');

    // No .md match found on current line - check if clicked on a path that continues to next line
    // Match path-like content (ending with \ or / or just path chars at end of line)
    const pathEndRegex = /[-a-zA-Z0-9_:.\\\/]+$/;
    const pathEndMatch = lineText.match(pathEndRegex);

    // Also check if this line starts with .md or md (reverse cross-line continuation)
    const continuationMatch = lineText.match(/^\s*(\.md|md|d)(?:\s|$|[,.:;!?)}\]])/);
    if (continuationMatch) {
      const suffixPart = continuationMatch[1];
      const suffixStart = lineText.indexOf(suffixPart);
      const suffixCellStart = strToCell[suffixStart] ?? suffixStart;

      // Check if click is within the suffix area (with 1-col left tolerance)
      if (x >= suffixCellStart - 1) {
        // Look back at previous line for path prefix
        const prevLineNum = bufferLine - 1;
        const prevLine = buffer.getLine(prevLineNum);
        if (prevLine) {
          const prevText = prevLine.translateToString(true);
          const prevEndMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/\u4e00-\u9fff ]+)$/);
          if (prevEndMatch) {
            const prevPart = prevEndMatch[1].trimStart();
            const combined = (prevPart + suffixPart).trim();
            if (combined.endsWith('.md') && /[-a-zA-Z0-9_:.\\\/\u4e00-\u9fff]+\.md$/.test(combined)) {
              let completePath = combined;

              // Continue looking back for more path prefix
              let lookbackLine = prevLineNum - 1;
              let pathPrefix = '';
              const isFirstPartAbsolute = /^[A-Za-z]:/.test(prevPart.trim()) || /^[.\/]/.test(prevPart.trim());

              if (!isFirstPartAbsolute) {
                while (lookbackLine >= 0) {
                  const lbLine = buffer.getLine(lookbackLine);
                  if (!lbLine) break;
                  const lbText = lbLine.translateToString(true);
                  const lbMatch = lbText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);
                  if (lbMatch) {
                    const lbPart = lbMatch[1];
                    const lbIndex = lbMatch.index ?? 0;
                    if (lbIndex > 0) {
                      const charBefore = lbText[lbIndex - 1];
                      if (isPathSeparator(charBefore, lbPart)) {
                        pathPrefix = lbPart + pathPrefix;
                        completePath = pathPrefix + completePath;
                        break;
                      }
                    }
                    pathPrefix = lbPart + pathPrefix;
                    lookbackLine--;
                  } else {
                    break;
                  }
                }
                if (pathPrefix && completePath === combined) {
                  completePath = pathPrefix + completePath;
                }
              }

              console.log('[DirectClick] Reverse cross-line match:', completePath);
              handleMdPathClick(completePath);
              e.stopPropagation();
              return;
            }
          }
        }
      }
    }

    if (pathEndMatch) {
      const matchedEnd = pathEndMatch[0];
      const matchStart = lineText.length - matchedEnd.length;


      // Check if click is on this path end
      if (x >= matchStart) {
        // Check next lines for .md
        let lookAheadLine = bufferLine + 1;
        let pathSuffix = '';

        // Look ahead up to 3 lines
        for (let i = 0; i < 3; i++) {
          const nextLine = buffer.getLine(lookAheadLine);
          if (!nextLine) break;

          const nextText = nextLine.translateToString(true);

          // Check if next line starts with path chars and has .md
          // Also match continuation patterns: just "md", "d", ".md" with optional leading whitespace
          const mdMatch = nextText.match(/^\s*(?:[-a-zA-Z0-9_:.\\\/]*\.md|md|d)(?:\s|$|[,.:;!?)}\]])/)
            || nextText.match(/^\s*(?:[-a-zA-Z0-9_:.\\\/]*\.md|md|d)$/);
          if (mdMatch) {
            pathSuffix = mdMatch[0].trim();

            // Now look back to find the complete path start
            let completePath = matchedEnd + pathSuffix;
            let lookbackLine = bufferLine - 1;
            let pathPrefix = '';

            // Check if matchedEnd starts with path separator (continuation from previous line)
            const isFirstPartAbsolute = /^[A-Za-z]:/.test(matchedEnd) || /^[.\/]/.test(matchedEnd);

            if (!isFirstPartAbsolute) {
              while (lookbackLine >= 0) {
                const prevLine = buffer.getLine(lookbackLine);
                if (!prevLine) break;

                const prevText = prevLine.translateToString(false);

                const prevMatch = prevText.match(/([-a-zA-Z0-9_:.\\\/]+)$/);

                if (prevMatch) {
                  const endPart = prevMatch[1];
                  const endIndex = prevMatch.index ?? 0;

                  // Check if there's a separator before the path chars
                  if (endIndex > 0) {
                    const charBefore = prevText[endIndex - 1];
                    if (isPathSeparator(charBefore, endPart)) {
                      // Found separator - this is the start of the path
                      pathPrefix = endPart + pathPrefix;
                      completePath = pathPrefix + completePath;
                      break;
                    }
                  }

                  // No separator - continue building path
                  pathPrefix = endPart + pathPrefix;
                  lookbackLine--;
                } else {
                  break;
                }
              }

              // If we collected a prefix but didn't set completePath, use it
              if (pathPrefix && completePath === matchedEnd + pathSuffix) {
                completePath = pathPrefix + completePath;
              }
            }

            handleMdPathClick(completePath);
            e.stopPropagation();
            return;
          }

          // Check if next line has path chars but no .md yet
          const pathContMatch = nextText.match(/^[-a-zA-Z0-9_:.\\\/]+/);
          if (pathContMatch) {
            pathSuffix = pathContMatch[0];
            lookAheadLine++;
          } else {
            break;
          }
        }
      }
    }
  });

  // Setup scroll tracking to detect user scroll
  setupScrollTracking();

  // Delay initial fit to ensure DOM is rendered
  setTimeout(() => {
    // [debug-loop] Log terminal dimensions at initialization
    const rect = terminalRef.value?.getBoundingClientRect();
    console.log('[TerminalTab][init] container rect:', JSON.stringify({ w: rect?.width, h: rect?.height }),
      'xterm:', terminal?.cols, 'x', terminal?.rows,
      'innerHeight:', window.innerHeight,
      'visualViewport:', JSON.stringify({ h: window.visualViewport?.height, offsetTop: window.visualViewport?.offsetTop }));
    safeFit();
    // NOTE: connectWebSocket() and scrollback restoration are deferred to
    // onTerminalOpened() which fires after viewport has stabilized
    // (keyboard animation complete). See waitForContainerAndOpen().
  }, 50);

  // Start periodic scrollback save
  saveScrollbackTimer = window.setInterval(() => {
    saveScrollback();
  }, 5000); // Save every 5 seconds

  // Setup touch event handling for pull-to-refresh prevention
  setupTouchHandling();

  // [debug-loop] fix: Removed TerminalTab's own setupVisualViewportHandling().
  // TerminalView.vue already has a viewport handler that:
  // 1. Adjusts terminal-page.style.bottom for keyboard height
  // 2. Calls fitActiveTab() via store → safeFit() → fitAddon.fit()
  // Having BOTH TerminalView and TerminalTab listen to visualViewport events
  // caused fit() to be called twice within 20ms (TerminalView at ~120ms, TerminalTab at ~100ms),
  // each triggering session:resize and PTY resize on the agent — causing screen width oscillation.
  // TerminalView's handler is the single source of truth for viewport-driven fit.

  terminal.onData((data) => {
    if (data === '\r' || data === '\n') {
      // Enter pressed — user is about to execute a command.
      // The next PS prompt we see in session:output will be the FRESH prompt
      // (reflecting the new CWD after the command runs).
      // Set flag so session:output handler knows to extract CWD from it.
      waitingForFreshPrompt = true;
      // Also unlock CWD so the fresh prompt can update it
      terminalStore.unlockTabCwd(props.tab.id);

      // Buffer-based capture for command history (existing logic)
      if (terminal) {
        const buffer = terminal.buffer.active;
        const currentLine = buffer.getLine(buffer.cursorY + buffer.baseY);
        if (currentLine) {
          const lineText = currentLine.translateToString(true);
          const commandMatch = lineText.match(/^PS\s+[^>]*>\s*(.*)$/);
          const commandText = commandMatch ? commandMatch[1] : lineText;
          if (commandText.trim()) {
            terminalStore.captureCommand(commandText);
          }
        }
      }
    }

    sendInput(data);
  });

  terminal.onResize(({ cols, rows }) => {
    // [debug-loop] fix: Only send resize when dimensions actually change.
    // Prevents duplicate session:resize from multiple fit() calls
    // (TerminalView + TerminalTab both have viewport handlers that fire within 20ms).
    if (shouldSendResize && ws && sessionId && (cols !== lastSentCols || rows !== lastSentRows)) {
      lastSentCols = cols;
      lastSentRows = rows;
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
    forceScrollToBottom();
  });

  // Register fit function for this tab (called on viewport resize)
  terminalStore.registerTabFitter(props.tab.id, () => {
    if (terminal) {
      const prevCols = terminal.cols;
      const prevRows = terminal.rows;
      safeFit();
      // [debug-loop] fix: After safeFit, xterm might not re-render if dimensions
      // didn't change. Force refresh.
      if (terminal.cols === prevCols && terminal.rows === prevRows) {
        try {
          (terminal as any).refresh(0, terminal.rows - 1);
          blackbox.log('fit', 'fitter:refresh', {
            tabId: props.tab.id?.slice(-6),
            cols: terminal.cols, rows: terminal.rows,
          });
        } catch { /* refresh might not be available */ }
      }
      forceScrollToBottom();
    }
  });
}

// Send input to the terminal
function sendInput(data: string) {
  if (ws && sessionId && ws.readyState === WebSocket.OPEN) {
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
    'CtrlC': '\x03',
    'CtrlD': '\x04',
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
    blackbox.log('ws', 'open', {
      tabId: props.tab.id?.slice(-6),
      agentId: props.tab.agentId,
      sessionId: props.tab.sessionId?.slice(-6) || null,
    });
    console.log('[TerminalTab] WebSocket opened, calling initVoiceWebSocket');
    ws?.send(JSON.stringify({
      type: 'auth',
      payload: { userId: authStore.userId, agentId: props.tab.agentId, sessionId: props.tab.sessionId || null },
      timestamp: Date.now(),
    }));
    // Initialize voice WebSocket with terminal WebSocket
    console.log('[TerminalTab] About to call initVoiceWebSocket, ws:', ws);
    initVoiceWebSocket(ws!);
    console.log('[TerminalTab] initVoiceWebSocket called');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    blackbox.log('ws', 'close', {
      tabId: props.tab.id?.slice(-6),
      sessionId: props.tab.sessionId?.slice(-6) || 'none',
    });
    console.log('[TerminalTab] WebSocket closed, tab:', props.tab.id, 'sessionId:', props.tab.sessionId || 'none');
    status.value = 'disconnected';
  };

  ws.onerror = () => {
    status.value = 'disconnected';
  };
}

function handleWsMessage(msg: any) {
  switch (msg.type) {
    case 'auth:result':
      blackbox.log('ws', 'auth:result', {
        tabId: props.tab.id?.slice(-6),
        success: msg.payload.success,
        hasSessionId: !!props.tab.sessionId,
        error: msg.payload.error,
      });
      console.log('[TerminalTab] auth:result received:', msg.payload, '| sessionId:', props.tab.sessionId ? 'present' : 'none');
      if (msg.payload.success) {
        if (props.tab.sessionId) {
          const resumeCols = terminal?.cols || 80;
          const resumeRows = terminal?.rows || 24;
          blackbox.log('ws', 'session:resume', {
            tabId: props.tab.id?.slice(-6),
            sessionId: props.tab.sessionId?.slice(-6),
            cols: resumeCols, rows: resumeRows,
          });
          // Try to resume existing session
          ws?.send(JSON.stringify({
            type: 'session:resume',
            sessionId: props.tab.sessionId,
            payload: { cols: resumeCols, rows: resumeRows },
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
      } else {
        // Auth failed
        console.error('[TerminalTab] auth failed:', msg.payload.error);
        status.value = 'disconnected';
        terminal?.write(`\r\n\x1b[31mAuth failed: ${msg.payload.error || 'Unknown error'}\x1b[0m\r\n`);
      }
      break;
    case 'session:created':
    case 'session:created':
      blackbox.log('ws', 'session:created', {
        tabId: props.tab.id?.slice(-6),
        success: msg.payload.success,
        sessionId: msg.payload.sessionId?.slice(-6),
        error: msg.payload.error,
      });
      console.log('[TerminalTab] session:created received:', msg.payload);
      if (msg.payload.success) {
        sessionId = msg.payload.sessionId;
        // Update the tab with the sessionId for persistence
        if (sessionId) {
          terminalStore.updateTabSessionId(props.tab.id, sessionId);
          // Notify server about active terminal session for voice commands
          sendActiveTerminalSession(sessionId);
        }
        // [debug-loop] fix: unlock CWD for new session and wait for first prompt
        terminalStore.unlockTabCwd(props.tab.id);
        waitingForFreshPrompt = true;
        // Don't execute commands here - wait for session:started
      } else {
        // Session creation failed - likely agent not connected
        console.error('[TerminalTab] session:created failed:', msg.payload.error);
        status.value = 'disconnected';
        terminal?.write(`\r\n\x1b[31mError: ${msg.payload.error || 'Agent not connected'}\x1b[0m\r\n`);
      }
      break;
    case 'session:resumed':
      if (msg.payload.success) {
        sessionId = props.tab.sessionId || null;
        status.value = 'connected';
        blackbox.log('ws', 'session:resumed', {
          tabId: props.tab.id?.slice(-6),
          sessionId: sessionId?.slice(-6),
          cols: terminal?.cols, rows: terminal?.rows,
          innerH: window.innerHeight,
          vvHeight: window.visualViewport?.height,
        });
        // [debug-loop] Log session:resumed with terminal dimensions
        const rect = terminalRef.value?.getBoundingClientRect();
        console.log('[TerminalTab][session:resumed] terminal:', terminal?.cols, 'x', terminal?.rows,
          'container:', JSON.stringify({ w: rect?.width, h: rect?.height }),
          'innerHeight:', window.innerHeight,
          'visualViewport.h:', window.visualViewport?.height);
        // [debug-loop] fix v3: After session resume, send wide-char recovery
        // Wait for agent's bump resize to complete (~550ms), then send recovery
        sendWideCharRecovery(600);

        // Also do safeFit to ensure terminal dimensions are correct
        // [debug-loop] fix v4: Two delayed fits — one after bump resize, one later
        // to handle Android keyboard animation that may still be in progress.
        setTimeout(() => {
          if (terminal && fitAddon) {
            console.log('[TerminalTab][session:resumed] fit@1000ms, innerHeight:', window.innerHeight);
            safeFit();
          }
        }, 1000);
        setTimeout(() => {
          if (terminal && fitAddon) {
            console.log('[TerminalTab][session:resumed] fit@2000ms, innerHeight:', window.innerHeight);
            safeFit();
          }
        }, 2000);
      } else {
        blackbox.log('ws', 'session:resumed:FAILED', {
          tabId: props.tab.id?.slice(-6),
          error: msg.payload.error,
        });
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
      console.log('[TerminalTab] session:started received, payload:', msg.payload);
      if (msg.payload.success) {
        status.value = 'connected';
        // Auto-execute commands after PTY is ready
        if (props.autoExecuteCommands && props.autoExecuteCommands.length > 0) {
          console.log('[TerminalTab] Starting command execution...');
          executeCommandsSequentially(props.autoExecuteCommands);
        }
      } else {
        console.error('[TerminalTab] session:started failed:', msg.payload.error);
        status.value = 'disconnected';
        terminal?.write(`\r\n\x1b[31mSession start failed: ${msg.payload.error || 'Unknown error'}\x1b[0m\r\n`);
      }
      break;
    case 'session:output':
      if (terminal) {
        sessionOutputCount++;
        // Log first few and every 50th message to track data flow
        if (sessionOutputCount <= 3 || sessionOutputCount % 50 === 0) {
          blackbox.log('ws', 'session:output', {
            tabId: props.tab.id?.slice(-6),
            count: sessionOutputCount,
            dataLen: msg.payload.data?.length || 0,
            dataPreview: msg.payload.data?.slice(0, 40)?.replace(/[\r\n]/g, '\\n'),
          });
        }
        terminal.write(msg.payload.data, () => {
          // Callback after write is processed
        });
      }
      // Track CWD from PS prompts in session:output.
      // Only update CWD when waitingForFreshPrompt is true — this means the prompt
      // is from the user's last command (not stale session:resume buffered output).
      // After extracting CWD, lock it to prevent future stale prompts from overwriting.
      if (msg.payload.data && waitingForFreshPrompt) {
        const cleanData = msg.payload.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        for (const rawLine of cleanData.split(/\r?\n/)) {
          // [debug-loop] fix: match PS prompt only at end of line (after > there should be
          // nothing or just whitespace). This prevents matching old prompt + command echo
          // on the same line like "PS D:\> cd ./claudeworkspace"
          const psMatch = rawLine.match(/PS\s+([A-Za-z]:[^\r\n>]+)>\s*$/);
          if (psMatch) {
            const newCwd = psMatch[1].trim();
            terminalStore.setTabCwd(props.tab.id, newCwd);
            terminalStore.lockTabCwd(props.tab.id);
            waitingForFreshPrompt = false;
            break;
          }
          const starshipMatch = rawLine.match(/([A-Za-z]:[^\r\n❯]+?)\s*(?:on\s+\w+\s*)?❯\s*$/);
          if (starshipMatch) {
            const newCwd = starshipMatch[1].trim();
            terminalStore.setTabCwd(props.tab.id, newCwd);
            terminalStore.lockTabCwd(props.tab.id);
            waitingForFreshPrompt = false;
            break;
          }
        }
      }
      // Auto-scroll to bottom if user hasn't scrolled up
      if (!userScrolledUp && terminal) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          terminal?.scrollToBottom();
        });
      }
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

// [debug-loop] fix: Removed setupVisualViewportHandling() and its variables.
// TerminalView.vue is now the single source of truth for viewport-driven fit.
// See comment in initTerminal() for details.
let viewportResizeTimeout: number | null = null; // Keep for cleanup compat (always null now)

// Setup touch handling to prevent pull-to-refresh
function setupTouchHandling() {
  if (!terminalRef.value) return;

  const wrapper = terminalRef.value;
  wrapper.style.touchAction = 'pan-y';

  const viewport = wrapper.querySelector('.xterm-viewport') as HTMLElement;
  if (viewport) {
    viewport.style.touchAction = 'pan-y';
  }

  const xterm = wrapper.querySelector('.xterm') as HTMLElement;
  if (xterm) {
    xterm.style.touchAction = 'pan-y';
  }

  // Momentum scroll implementation
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let animationId: number | null = null;

  wrapper.addEventListener('touchstart', (e: TouchEvent) => {
    lastY = e.touches[0].clientY;
    lastTime = Date.now();
    velocity = 0;
    // Stop any ongoing momentum scroll
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }, { passive: true });

  wrapper.addEventListener('touchmove', (e: TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const currentTime = Date.now();
    const deltaY = lastY - currentY;
    const deltaTime = currentTime - lastTime;

    if (deltaTime > 0) {
      velocity = deltaY / deltaTime;
    }

    lastY = currentY;
    lastTime = currentTime;
  }, { passive: true });

  wrapper.addEventListener('touchend', () => {
    // Apply momentum scroll based on velocity
    if (Math.abs(velocity) > 0.5 && viewport && terminal) {
      const friction = 0.95;
      const minVelocity = 0.1;

      const momentumScroll = () => {
        if (Math.abs(velocity) < minVelocity || !viewport || !terminal) {
          animationId = null;
          return;
        }

        // Calculate scroll amount based on velocity
        const scrollAmount = Math.round(velocity * 16); // 16ms per frame
        const currentScroll = viewport.scrollTop;
        viewport.scrollTop = currentScroll + scrollAmount;

        // Apply friction
        velocity *= friction;

        animationId = requestAnimationFrame(momentumScroll);
      };

      animationId = requestAnimationFrame(momentumScroll);
    }
  }, { passive: true });
}

// Save scrollback to sessionStorage
function saveScrollback() {
  if (terminal && serializeAddon && props.tab.id) {
    try {
      const serialized = serializeAddon.serialize();
      const lineCount = serialized.split('\n').length;
      console.log(`[TerminalTab] Saving scrollback for ${props.tab.id}: ${serialized.length} chars, ~${lineCount} lines`);
      sessionStorage.setItem(`scrollback:${props.tab.id}`, serialized);
    } catch (e) {
      console.error('[TerminalTab] Failed to save scrollback:', e);
    }
  }
}

function cleanup() {
  // Abort any pending command execution
  shouldAbortExecution = true;

  // Stop scrollback save timer
  if (saveScrollbackTimer) {
    clearInterval(saveScrollbackTimer);
    saveScrollbackTimer = null;
  }

  // Clear pending viewport resize timeout
  if (viewportResizeTimeout !== null) {
    clearTimeout(viewportResizeTimeout);
    viewportResizeTimeout = null;
  }

  // [debug-loop] fix: Removed viewportResizeHandler cleanup — setupVisualViewportHandling()
  // was removed. TerminalView.vue handles viewport cleanup via its own cleanupViewportHandling.

  // Save scrollback before cleanup
  saveScrollback();

  // Don't close the session when navigating away - let it persist for resume
  // Only close the WebSocket without sending session:close
  if (ws) {
    // Don't send session:close - we want to be able to resume
    // The server will handle session persistence when we disconnect
    ws.close();
  }
  // 立即清除语音 WS 引用，避免录音时路由到已关闭的连接
  clearTerminalVoiceWebSocket();
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
}
.terminal { width: 100%; height: 100%; }
.status-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 15, 35, 0.92);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 500;
}
.status-overlay.error { color: var(--error); }

.status-overlay .spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--accent-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: var(--space-2);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Prevent pull-to-refresh on all xterm elements */
.terminal-wrapper :deep(.xterm),
.terminal-wrapper :deep(.xterm-viewport),
.terminal-wrapper :deep(.xterm-screen) {
  touch-action: pan-y;
}
</style>