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
          <div v-if="loading" class="menu-item loading">
            <span class="spinner-sm"></span>
            Loading...
          </div>
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
          <div v-if="shortcuts.length === 0" class="menu-item no-shortcuts empty-state-mini">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span>暂无快捷方式</span>
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
        <router-link to="/files" class="action-btn" title="文件" aria-label="文件管理">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
        </router-link>
        <div class="history-dropdown" v-if="historyTabs.length > 0">
          <button class="history-btn" @click="showHistory = !showHistory" title="历史记录" aria-label="历史记录">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>
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
        <router-link to="/settings" class="action-btn" title="设置" aria-label="设置">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </router-link>
        <button @click="logout" class="action-btn power-btn" title="登出" aria-label="登出">
          <span class="power-icon"></span>
        </button>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
        <p>选择一个 Agent 开始终端会话</p>
        <p class="hint">点击上方 "Agents" 选择在线的 Agent</p>
      </div>
      <TerminalTab v-for="tab in tabs" :key="tab.id" :tab="tab" :visible="tab.id === activeTabId" :auto-execute-commands="tab.autoExecuteCommands" />
    </div>
    <!-- 底部快捷键按钮 -->
    <div class="bottom-bar" v-if="tabs.length > 0">
      <button class="key-btn tab-btn" @click="sendKey('Tab')">Tab</button>
      <button class="key-btn capture-btn" @click="openSaveModal" :disabled="capturedCommands.length === 0" title="保存为快捷方式">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.37 2.63 14 7"/><path d="M21 1.5V6h-4.5"/><path d="m21 3-8 8"/><path d="m16 8 4.5 4.5"/></svg>
        </button>
      <button class="key-btn ctrl-c-btn" @click="sendKey('CtrlC')" title="Ctrl+C 中断">C</button>
      <button class="key-btn ctrl-d-btn" @click="sendKey('CtrlD')" title="Ctrl+D 退出/EOF">D</button>
      <div class="spacer"></div>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowLeft')">←</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowUp')">↑</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowDown')">↓</button>
      <button class="key-btn arrow-btn" @click="sendKey('ArrowRight')">→</button>
      <button class="key-btn bottom-btn" @click="scrollToBottom" title="滚动到底部">
        <span class="to-bottom-icon"></span>
      </button>
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
    <!-- Debug panel - shows viewport metrics for mobile debugging -->
    <div class="debug-panel" v-if="showDebugPanel" @mousedown.prevent @touchstart.prevent>
      <div class="debug-header" @click="debugCollapsed = !debugCollapsed">
        <span>🔍 Debug {{ debugCollapsed ? '▶' : '▼' }}</span>
        <span class="debug-actions">
          <button @click.stop="copyBlackbox" @touchend.stop.prevent="copyBlackbox" class="debug-export">上报</button>
          <button @click.stop="showDebugPanel = false" class="debug-close">×</button>
        </span>
      </div>
      <div v-show="!debugCollapsed" class="debug-body">
        <div>innerH: {{ debugInfo.innerHeight }}</div>
        <div>vv.height: {{ debugInfo.vvHeight }}</div>
        <div>vv.offsetTop: {{ debugInfo.vvOffsetTop }}</div>
        <div>keyboardH: {{ debugInfo.keyboardHeight }}</div>
        <div>page.top: {{ debugInfo.pageTop }}</div>
        <div>page.height: {{ debugInfo.pageHeight }}</div>
        <div>page.bottom: {{ debugInfo.pageBottom }}</div>
        <div>containerH: {{ debugInfo.containerHeight }}</div>
        <div>xterm: {{ debugInfo.xtermCols }}×{{ debugInfo.xtermRows }}</div>
        <div>rect.top: {{ debugInfo.pageRectTop }}</div>
        <div>rect.bottom: {{ debugInfo.pageRectBottom }}</div>
        <div>rect.height: {{ debugInfo.pageRectHeight }}</div>
        <div class="debug-separator">── 内容位移机制 ──</div>
        <div>fitCount: {{ debugInfo.fitCount }}</div>
        <div>wrapperH: {{ debugInfo.wrapperRectH }}</div>
        <div>wrapperW: {{ debugInfo.wrapperRectW }}</div>
        <div>activeTab: {{ debugInfo.activeTabId?.slice(-6) || 'none' }}</div>
        <div>fitterCount: {{ debugInfo.fitterCount }}</div>
        <div class="debug-separator">── safeFit 统计 ──</div>
        <div>sf.calls: {{ debugInfo.sfCalls }}</div>
        <div>sf.skipped: {{ debugInfo.sfSkipped }}</div>
        <div>sf.fitted: {{ debugInfo.sfFitted }}</div>
        <div>sf.rectH: {{ debugInfo.sfLastRectH }}</div>
        <div>sf.rows: {{ debugInfo.sfLastRows }}</div>
        <div>sf.reason: {{ debugInfo.sfReason }}</div>
        <div class="debug-separator">── 黑匣子 ({{ debugInfo.bbCount }}) ──</div>
        <div v-for="(evt, i) in debugInfo.bbRecent" :key="i" class="debug-bb-event">
          {{ evt.t }}ms {{ evt.cat }}:{{ evt.event }}
          <span v-if="evt.data" class="debug-bb-data">{{ formatBbData(evt.data) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTerminalStore } from '../stores/terminal';
import { useSettingsStore } from '../stores/settings';
import TerminalTab from '../components/TerminalTab.vue';
import { sendActiveTerminalSession } from '../services/voiceWebSocket';
import { blackbox } from '../utils/eventLogger';

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

// Debug panel state — only visible with ?debug URL param or localStorage
const showDebugPanel = ref(
  new URLSearchParams(window.location.search).has('debug') ||
  localStorage.getItem('debug-panel') === 'true'
);
const debugCollapsed = ref(false); // Expanded by default
const debugInfo = ref({
  innerHeight: 0,
  vvHeight: 0,
  vvOffsetTop: 0,
  keyboardHeight: 0,
  pageTop: '',
  pageHeight: '',
  pageBottom: '',
  containerHeight: 0,
  xtermCols: 0,
  xtermRows: 0,
  pageRectTop: 0,
  pageRectBottom: 0,
  pageRectHeight: 0,
  // New debug vars to observe "content shift down" mechanism
  fitCount: 0,
  wrapperRectH: 0,
  wrapperRectW: 0,
  activeTabId: '',
  fitterCount: 0,
  // safeFit stats from TerminalTab
  sfCalls: 0,
  sfSkipped: 0,
  sfFitted: 0,
  sfLastRectH: 0,
  sfLastRows: 0,
  sfReason: '',
  // Blackbox
  bbCount: 0,
  bbRecent: [] as Array<{ t: number; cat: string; event: string; data?: Record<string, unknown> }>,
});
let debugInterval: number | null = null;
let fitCallCount = 0; // Track how many times fitActiveTab is called

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
  let resizeTimeout: number | null = null;
  let rafId: number | null = null;
  let lastAppliedHeight = 0;
  let stableCount = 0;
  let adjustStartTime = Date.now();

  const doFitAndScroll = () => {
    fitCallCount++;
    blackbox.log('fit', 'doFitAndScroll', {
      callNum: fitCallCount,
      activeTabId: terminalStore.activeTabId,
      innerH: window.innerHeight,
      vvHeight: window.visualViewport?.height,
    });
    terminalStore.fitActiveTab();
    terminalStore.scrollActiveTabToBottom();
  };

  // [debug-loop] fix v11: Continuous RAF-based viewport adjustment.
  //
  // Root cause of previous failures: when navigating back from file manager
  // with keyboard open, the retry interval (5×200ms=1s) captured
  // visualViewport.height during the keyboard animation (e.g., 753→600→464)
  // and applied a wrong intermediate value. After retry ended, no further
  // adjustments were made.
  //
  // New approach:
  // 1. Use requestAnimationFrame for continuous adjustment (matches browser paint cycle)
  // 2. Use window.innerHeight (not vv.height) — on Android, innerHeight SHRINKS
  //    when keyboard opens (753→464), matching the visible area exactly.
  //    No dependency on vv.offsetTop which may be stale during animation.
  // 3. Auto-stop when values stabilize (5 consecutive stable frames) OR after 5 seconds
  // 4. visualViewport events still trigger immediate handler for manual keyboard toggle
  const applyViewport = () => {
    const vv = window.visualViewport;
    // On Android: innerHeight shrinks when keyboard opens (equals vv.height)
    // On iOS: innerHeight stays constant; vv.height reflects keyboard reduction
    // Use the smaller of innerHeight and vv.height to handle both cases
    const vvHeight = vv?.height ?? window.innerHeight;
    const effectiveHeight = Math.min(window.innerHeight, vvHeight);
    const vvOffsetTop = vv?.offsetTop ?? 0;

    // Skip if nothing changed (prevents unnecessary layout thrashing)
    const lastTop = parseInt(terminalPage.style.top) || 0;
    const lastHeight = parseInt(terminalPage.style.height) || 0;
    const topChanged = Math.abs(vvOffsetTop - lastTop) > 1;
    const heightChanged = Math.abs(effectiveHeight - lastHeight) > 1;

    if (topChanged || heightChanged) {
      terminalPage.style.top = `${vvOffsetTop}px`;
      terminalPage.style.height = `${effectiveHeight}px`;
      void terminalPage.offsetHeight; // force reflow
      doFitAndScroll();
    } else if (stableCount === 0) {
      // First frame: always fit to ensure correct initial state
      doFitAndScroll();
    }
    // When stable and unchanged: skip fit entirely (prevents stutter)

    console.log('[TerminalView][raf] top:', vvOffsetTop,
      'height:', effectiveHeight,
      'innerH:', window.innerHeight,
      'vv.height:', vvHeight);
    blackbox.log('raf', 'applyViewport', {
      top: vvOffsetTop, height: effectiveHeight,
      innerH: window.innerHeight, vvHeight,
      stableCount, elapsed: Date.now() - adjustStartTime,
    });

    // Auto-stop: compare with previously applied values
    if (effectiveHeight === lastAppliedHeight) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastAppliedHeight = effectiveHeight;

    const elapsed = Date.now() - adjustStartTime;
    // Stop after 10 consecutive stable frames OR after 5 seconds max
    if (stableCount >= 10 || elapsed > 5000) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      console.log('[TerminalView][raf] stopped. stable count:', stableCount, 'elapsed:', elapsed, 'final height:', effectiveHeight);
      blackbox.log('raf', 'stopped', {
        stableCount, elapsed, finalHeight: effectiveHeight,
      });
    }
  };

  const startContinuousAdjust = () => {
    stableCount = 0;
    lastAppliedHeight = 0; // Reset so first frame doesn't count as "stable"
    adjustStartTime = Date.now();
    const loop = () => {
      applyViewport();
      const elapsed = Date.now() - adjustStartTime;
      if (stableCount < 10 && elapsed <= 5000) {
        rafId = requestAnimationFrame(loop);
      }
    };
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  };

  const handleViewportChange = () => {
    if (resizeTimeout !== null) {
      clearTimeout(resizeTimeout);
    }

    resizeTimeout = window.setTimeout(() => {
      resizeTimeout = null;
      applyViewport();
      // Restart continuous adjustment when viewport changes
      // (keyboard open/close, address bar collapse)
      startContinuousAdjust();
    }, 20);
  };

  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('scroll', handleViewportChange);
  // Backup for Android browsers that may not fire visualViewport events reliably
  window.addEventListener('resize', handleViewportChange);

  // Start continuous adjustment on mount
  startContinuousAdjust();

  // Return cleanup function
  return () => {
    if (resizeTimeout !== null) {
      clearTimeout(resizeTimeout);
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    window.visualViewport?.removeEventListener('resize', handleViewportChange);
    window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    window.removeEventListener('resize', handleViewportChange);
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
  // Reset fit counter for this mount cycle
  fitCallCount = 0;
  blackbox.log('navigation', 'TerminalView:mounted', {
    innerH: window.innerHeight,
    vvHeight: window.visualViewport?.height,
    vvOffsetTop: window.visualViewport?.offsetTop,
    tabsCount: terminalStore.tabs.length,
    activeTabId: terminalStore.activeTabId,
  });
  // Initialize user-specific data (history, shortcuts)
  if (authStore.username) {
    terminalStore.initUserData(authStore.username);
  }

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

  // Debug panel: update metrics every 200ms (only when visible)
  if (showDebugPanel.value) {
  debugInterval = window.setInterval(() => {
    const vv = window.visualViewport;
    const innerHeight = window.innerHeight;
    const vvHeight = vv?.height ?? 0;
    const vvOffsetTop = vv?.offsetTop ?? 0;
    const keyboardHeight = Math.max(0, innerHeight - vvHeight);

    const page = terminalPageRef.value;
    const container = page?.querySelector('.terminal-container') as HTMLElement | null;

    // Get xterm dimensions from the VISIBLE terminal (active tab)
    let xtermCols = 0;
    let xtermRows = 0;
    let wrapperRectH = 0;
    let wrapperRectW = 0;
    // Find the visible .terminal-wrapper (the one without display:none)
    const wrappers = document.querySelectorAll('.terminal-wrapper');
    for (const wrapper of wrappers) {
      if ((wrapper as HTMLElement).style.display !== 'none') {
        const wRect = wrapper.getBoundingClientRect();
        wrapperRectH = Math.round(wRect.height);
        wrapperRectW = Math.round(wRect.width);
        const xtermEl = wrapper.querySelector('.terminal') as any;
        if (xtermEl?.__xterm) {
          xtermCols = xtermEl.__xterm.cols;
          xtermRows = xtermEl.__xterm.rows;
        }
        break;
      }
    }

    // Count registered fitters (to check if active tab has a fitter)
    const fitterCount = terminalStore.tabs.length; // Each tab registers a fitter when initialized

    // Read safeFit stats from TerminalTab (exposed via window)
    const sf = (window as any).__safeFitStats || {};

    debugInfo.value = {
      innerHeight,
      vvHeight,
      vvOffsetTop,
      keyboardHeight,
      pageTop: page?.style.top ?? '',
      pageHeight: page?.style.height ?? '',
      pageBottom: page?.style.bottom ?? '',
      containerHeight: container ? Math.round(container.getBoundingClientRect().height) : 0,
      xtermCols,
      xtermRows,
      // Actual rendered position of terminal-page
      pageRectTop: page ? Math.round(page.getBoundingClientRect().top) : -1,
      pageRectBottom: page ? Math.round(page.getBoundingClientRect().bottom) : -1,
      pageRectHeight: page ? Math.round(page.getBoundingClientRect().height) : -1,
      // New: observe "content shift down" mechanism
      fitCount: fitCallCount,
      wrapperRectH,
      wrapperRectW,
      activeTabId: terminalStore.activeTabId || '',
      fitterCount,
      sfCalls: sf.calls || 0,
      sfSkipped: sf.skipped || 0,
      sfFitted: sf.fitted || 0,
      sfLastRectH: sf.lastRectH || 0,
      sfLastRows: sf.lastRows || 0,
      sfReason: sf.reason || '',
      // Blackbox
      bbCount: blackbox.count(),
      bbRecent: blackbox.recent(5),
    };
  }, 200);
  } // end if (showDebugPanel)
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
  blackbox.log('navigation', 'TerminalView:unmounted', {
    fitCallCount,
    tabsCount: terminalStore.tabs.length,
  });
  if (intervalId) clearInterval(intervalId);
  if (debugInterval) clearInterval(debugInterval);
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
  terminalStore.focusActiveTab();
  // Notify server about active terminal session for voice commands
  const tab = tabs.value.find(t => t.id === id);
  sendActiveTerminalSession(tab?.sessionId || null);
}

// Watch for active tab changes and notify server
watch(activeTabId, (newTabId) => {
  if (newTabId) {
    const tab = tabs.value.find(t => t.id === newTabId);
    sendActiveTerminalSession(tab?.sessionId || null);
  } else {
    sendActiveTerminalSession(null);
  }
});

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
    // Focus terminal after returning
    terminalStore.focusActiveTab();
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

// Export blackbox data to clipboard AND auto-send to server
async function copyBlackbox() {
  const data = blackbox.exportJSON();
  const label = `bug-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;

  // Auto-send to server
  try {
    const apiUrl = settingsStore.settings.apiUrl;
    const response = await fetch(`${apiUrl}/api/blackbox/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: blackbox.export().events,
        startTime: blackbox.export().startTime,
        label,
      }),
    });
    const result = await response.json();
    alert(`✅ 黑匣子已上报服务器！\nID: ${result.id}\n事件数: ${result.eventCount}\n\n（我也复制到了剪贴板）`);
  } catch (err) {
    alert(`❌ 上报失败: ${(err as Error).message}\n数据已复制到剪贴板，请手动发送`);
  }

  // Also copy to clipboard
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(data);
    } catch { /* ignore */ }
  }
}

// Format blackbox event data for display
function formatBbData(data: Record<string, unknown>): string {
  if (!data) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  }
  return parts.join(' ');
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
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  /* bottom is controlled by JS via style.height to adapt to visual viewport.
   * Do NOT set bottom: 0 here — it conflicts with JS-set height on some Android browsers,
   * causing height to be ignored and element to stretch from top to bottom. */
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  /* [debug-loop] fix: Allow flex children to shrink below content size.
   * Without this, flex items use min-height: auto which prevents shrinking
   * below their content. This causes terminal-container to overflow when
   * the page height is reduced by the keyboard. */
  min-height: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  background: rgba(22, 33, 62, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: var(--space-2) var(--space-3);
  gap: 0;
  border-bottom: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
  position: relative;
  z-index: 50;
}

.agents-dropdown {
  position: relative;
  z-index: 200;
  flex-shrink: 1;
  min-width: 0;
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
  transition: background var(--transition-fast);
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

.menu-item:hover {
  background: var(--bg-surface-hover);
}

.menu-item.loading,
.menu-item.no-agents {
  color: var(--text-muted);
  cursor: default;
}

.menu-item.loading .spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--accent-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: var(--space-2);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.menu-item.error {
  color: var(--error);
  cursor: default;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.status-dot.online {
  background: var(--success);
  box-shadow: 0 0 6px var(--success);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
  flex-shrink: 0;
}

.history-dropdown {
  position: relative;
  z-index: 200;
}

.history-btn {
  padding: var(--space-2);
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
  min-height: 38px;
  min-width: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-btn:hover {
  color: var(--text-primary);
  background: var(--accent-subtle);
}

.history-menu {
  right: 0;
  left: auto;
  min-width: 220px;
}

.menu-header {
  padding: var(--space-2) var(--space-3);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-subtle);
}

.history-item {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
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
  color: var(--text-muted);
}

.action-btn {
  padding: var(--space-2);
  background: none;
  border: none;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
  min-height: 38px;
  min-width: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn:hover {
  color: var(--accent);
  background: var(--accent-subtle);
}

/* Power button icon */
.power-btn {
  position: relative;
}

.power-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-radius: 50%;
  position: relative;
}

.power-icon::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 8px;
  background: currentColor;
}

/* 会话标签栏 - 第二行 */
.tabs-bar {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  padding: var(--space-1) var(--space-2);
  gap: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.tabs-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.tabs-scroll::-webkit-scrollbar {
  height: 3px;
}

.tabs-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.tabs-scroll::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 2px;
}

.tabs {
  display: flex;
  gap: var(--space-1);
  white-space: nowrap;
}

.tab {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.3rem 0.5rem;
  background: var(--bg-surface-elevated);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
  animation: tab-in var(--duration-base) ease;
}

@keyframes tab-in {
  from {
    opacity: 0;
    transform: translateX(8px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

.tab.active {
  color: var(--text-on-accent);
  background: var(--accent);
  box-shadow: var(--shadow-sm);
}

.tab .close {
  font-size: 0.9rem;
  opacity: 0.5;
  transition: opacity var(--transition-fast), color var(--transition-fast);
  margin-left: 2px;
}

.tab .close:hover {
  opacity: 1;
  color: var(--error);
}

.add-tab-btn {
  padding: 0.3rem 0.6rem;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-on-accent);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition-fast), transform var(--transition-fast);
}

.add-tab-btn:hover {
  background: var(--accent-hover);
}

.add-tab-btn:active {
  transform: scale(0.96);
}

.terminal-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg-root);
  /* [debug-loop] fix: Critical for keyboard adaptation.
   * flex:1 elements default to min-height: auto, which prevents them from
   * shrinking below their content size. When keyboard opens and page height
   * shrinks from 753px to 464px, the container must shrink too.
   * Without min-height:0, the container stays at its content height (e.g., 582px)
   * even though the parent page is only 464px, causing content to overflow. */
  min-height: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  text-align: center;
  padding: var(--space-6);
  gap: var(--space-3);
}

.empty-state .empty-icon {
  color: var(--text-muted);
  opacity: 0.3;
}

.empty-state .hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 0;
}

/* 底部快捷键按钮 */
.bottom-bar {
  display: flex;
  align-items: center;
  padding: var(--space-1);
  background: rgba(22, 33, 62, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  gap: var(--space-1);
  border-top: 1px solid var(--border-subtle);
}

.spacer {
  width: var(--space-1);
  flex-shrink: 0;
}

.key-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 0 0;
  min-width: 0;
  height: 40px;
  padding: 0;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  transition: background var(--transition-fast), transform var(--transition-fast);
}

.key-btn:active {
  transform: scale(0.95);
}

.tab-btn {
  background: var(--gradient-btn-purple);
  box-shadow: var(--shadow-inset-sm), var(--shadow-sm);
  font-weight: 700;
  font-size: 0.8rem;
}

.tab-btn:active {
  background: var(--gradient-btn-purple);
  box-shadow: var(--shadow-inset-md);
  transform: scale(0.95);
}

.ctrl-c-btn {
  background: var(--gradient-btn-danger);
  box-shadow: var(--shadow-inset-sm), var(--shadow-sm);
  font-weight: 700;
}

.ctrl-c-btn:active {
  background: var(--gradient-btn-danger);
  box-shadow: var(--shadow-inset-md);
  transform: scale(0.95);
}

.ctrl-d-btn {
  background: var(--gradient-btn-info);
  box-shadow: var(--shadow-inset-sm), var(--shadow-sm);
  font-weight: 700;
}

.ctrl-d-btn:active {
  background: var(--gradient-btn-info);
  box-shadow: var(--shadow-inset-md);
  transform: scale(0.95);
}

.arrow-btn {
  font-size: 1rem;
  background: linear-gradient(180deg, var(--bg-surface-elevated) 0%, rgba(30, 42, 74, 0.8) 100%);
  box-shadow: var(--shadow-inset-sm);
}

.bottom-btn {
  background: var(--gradient-btn-success);
  box-shadow: var(--shadow-inset-sm), var(--shadow-sm);
}

.bottom-btn:active {
  background: var(--gradient-btn-success);
  box-shadow: var(--shadow-inset-md);
  transform: scale(0.95);
}

/* 记录按钮 */
.capture-btn {
  background: var(--gradient-btn-accent);
  box-shadow: var(--shadow-inset-sm), var(--shadow-sm);
}

.capture-btn svg {
  width: 16px;
  height: 16px;
}

.capture-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.capture-btn:not(:disabled):active {
  background: var(--gradient-btn-accent);
  box-shadow: var(--shadow-inset-md);
  transform: scale(0.95);
}

/* To bottom icon */
.to-bottom-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.to-bottom-icon::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid var(--text-on-accent);
}

.to-bottom-icon::after {
  content: '';
  width: 14px;
  height: 2px;
  background: var(--text-on-accent);
}

/* 底部作者栏 */
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

/* 快捷方式下拉框 */
.shortcuts-dropdown {
  position: relative;
  z-index: 200;
  flex-shrink: 1;
  min-width: 0;
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

.shortcut-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.delete-btn {
  padding: var(--space-1) var(--space-2);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1.2rem;
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

/* 弹窗样式 */
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
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.command-list {
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-root);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.command-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast);
}

.command-item:last-child {
  border-bottom: none;
}

.command-item:hover {
  background: var(--bg-surface);
}

.command-item input[type="checkbox"] {
  accent-color: var(--accent);
  width: 18px;
  height: 18px;
}

.command-text {
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
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

.menu-item.no-shortcuts.empty-state-mini {
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  opacity: 0.6;
}

/* Debug panel */
.debug-panel {
  position: fixed;
  top: 48px;
  right: 4px;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  color: #0f0;
  font-family: monospace;
  font-size: 10px;
  line-height: 1.3;
  border-radius: 6px;
  min-width: 170px;
  max-width: 200px;
  pointer-events: auto;
  border: 1px solid rgba(0, 255, 0, 0.3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  background: rgba(0, 255, 0, 0.1);
  border-radius: 6px 6px 0 0;
  font-weight: bold;
}
.debug-actions {
  display: flex;
  gap: 4px;
}
.debug-export {
  background: rgba(100, 200, 255, 0.3);
  border: 1px solid #6cf;
  color: #6cf;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  min-height: 28px;
}
.debug-export:active {
  background: rgba(100, 200, 255, 0.6);
}
.debug-close {
  background: none;
  border: none;
  color: #f66;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
.debug-body {
  padding: 4px 8px;
}
.debug-body div {
  white-space: nowrap;
}
.debug-separator {
  color: #ff0 !important;
  text-align: center;
  margin: 2px 0;
  font-size: 9px;
}
.debug-bb-event {
  color: #aaf !important;
  font-size: 9px;
  border-bottom: 1px solid rgba(100, 100, 255, 0.2);
  padding: 1px 0;
}
.debug-bb-data {
  color: #888 !important;
  font-size: 8px;
}
</style>