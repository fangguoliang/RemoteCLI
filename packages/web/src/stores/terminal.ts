import { defineStore } from 'pinia';
import { ref, reactive, watch } from 'vue';

export interface Tab {
  id: string;
  title: string;
  agentId: string;
  createdAt: number;
  sessionId?: string; // Optional: used for session persistence
  autoExecuteCommands?: string[]; // Optional: commands to auto-execute on session start
}

// Captured command from terminal session
export interface CapturedCommand {
  text: string;
  timestamp: number;
}

// User-created shortcut for executing command sequences
export interface Shortcut {
  id: string;
  name: string;
  commands: string[];
  agentId: string;
  createdAt: number;
}

interface StoredSession {
  tabs: Tab[];
  activeTabId: string | null;
  tabCwd?: Record<string, string>;
}

const SESSION_KEY = 'remotecli-terminal-session';
const CAPTURED_KEY = 'remotecli-captured-commands';
const MAX_HISTORY = 10;
const MAX_SHORTCUTS = 10;
const MAX_CAPTURED_COMMANDS = 100;

// User-specific storage keys
function getHistoryKey(username: string): string {
  return `remotecli-terminal-history-${username}`;
}

function getShortcutsKey(username: string): string {
  return `remotecli-shortcuts-${username}`;
}

// Key sender function type
type KeySender = (key: string) => void;

// Session storage (temporary, cleared on browser close)
function loadSessionData(): StoredSession | null {
  try {
    const data = sessionStorage.getItem(SESSION_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
  return null;
}

function saveSessionData(data: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

function clearSessionData(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error('Failed to clear session:', e);
  }
}

// History storage (persistent, survives browser close, user-specific)
function loadHistoryData(username: string): Tab[] {
  if (!username) return [];
  try {
    const data = localStorage.getItem(getHistoryKey(username));
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
  return [];
}

function saveHistoryData(tabs: Tab[], username: string): void {
  if (!username) return;
  try {
    localStorage.setItem(getHistoryKey(username), JSON.stringify(tabs));
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

function clearHistoryData(username: string): void {
  if (!username) return;
  try {
    localStorage.removeItem(getHistoryKey(username));
  } catch (e) {
    console.error('Failed to clear history:', e);
  }
}

// Captured commands storage (session-based)
function loadCapturedCommands(): CapturedCommand[] {
  try {
    const data = sessionStorage.getItem(CAPTURED_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load captured commands:', e);
  }
  return [];
}

function saveCapturedCommands(commands: CapturedCommand[]): void {
  try {
    sessionStorage.setItem(CAPTURED_KEY, JSON.stringify(commands));
  } catch (e) {
    console.error('Failed to save captured commands:', e);
  }
}

function clearCapturedCommandsStorage(): void {
  try {
    sessionStorage.removeItem(CAPTURED_KEY);
  } catch (e) {
    console.error('Failed to clear captured commands:', e);
  }
}

// Shortcuts storage (persistent, user-specific)
function loadShortcuts(username: string): Shortcut[] {
  if (!username) return [];
  try {
    const data = localStorage.getItem(getShortcutsKey(username));
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load shortcuts:', e);
  }
  return [];
}

function saveShortcuts(shortcuts: Shortcut[], username: string): void {
  if (!username) return;
  try {
    localStorage.setItem(getShortcutsKey(username), JSON.stringify(shortcuts));
  } catch (e) {
    console.error('Failed to save shortcuts:', e);
  }
}

function clearShortcutsData(username: string): void {
  if (!username) return;
  try {
    localStorage.removeItem(getShortcutsKey(username));
  } catch (e) {
    console.error('Failed to clear shortcuts:', e);
  }
}

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<Tab[]>([]);
  const activeTabId = ref<string | null>(null);
  const agents = ref<{ agentId: string; name: string; online: boolean }[]>([]);
  const capturedCommands = ref<CapturedCommand[]>(loadCapturedCommands());
  const shortcuts = ref<Shortcut[]>([]);

  // Track current working directory per tab (tabId -> cwd)
  // [debug-loop] fix: persist tabCwd in sessionStorage to survive mobile browser page freezes/reloads
  const tabCwd = reactive<Record<string, string>>(loadSessionData()?.tabCwd || {});

  // Track which tabs have CWD locked by cd detection handler
  // When user types cd/Set-Location, the CWD is known authoritatively.
  // Lock prevents stale PS prompts from session:resume buffered output
  // from overwriting the correct CWD.
  const tabCwdLocked = new Set<string>();

  // Current username for user-specific storage
  let currentUsername = '';

  // Registry for key senders (tabId -> sendKey function)
  const keySenders = new Map<string, KeySender>();

  // Initialize user-specific data (call on login)
  function initUserData(username: string) {
    currentUsername = username;
    historyTabs.value = loadHistoryData(username);
    shortcuts.value = loadShortcuts(username);
  }

  // Get current username
  function getUsername(): string {
    return currentUsername;
  }

  // History tabs (lazy loaded on initUserData)
  const historyTabs = ref<Tab[]>([]);

  // Watch for changes and auto-save session
  // [debug-loop] fix: include tabCwd in persisted session data
  watch(
    [tabs, activeTabId],
    () => {
      if (tabs.value.length > 0) {
        saveSessionData({
          tabs: tabs.value,
          activeTabId: activeTabId.value,
          tabCwd: { ...tabCwd },
        });
      }
    },
    { deep: true }
  );

  // Watch history and auto-save to localStorage (user-specific)
  watch(
    historyTabs,
    () => {
      if (currentUsername) {
        saveHistoryData(historyTabs.value, currentUsername);
      }
    },
    { deep: true }
  );

  // Watch captured commands and auto-save to sessionStorage
  watch(
    capturedCommands,
    () => {
      saveCapturedCommands(capturedCommands.value);
    },
    { deep: true }
  );

  // Watch shortcuts and auto-save to localStorage (user-specific)
  watch(
    shortcuts,
    () => {
      if (currentUsername) {
        saveShortcuts(shortcuts.value, currentUsername);
      }
    },
    { deep: true }
  );

  function addTab(tab: Tab) {
    tabs.value.push(tab);
    activeTabId.value = tab.id;

    // Add to history (keep most recent first, allow multiple sessions per agent)
    // Remove duplicate by id if exists
    const existingIndex = historyTabs.value.findIndex(t => t.id === tab.id);
    if (existingIndex !== -1) {
      historyTabs.value.splice(existingIndex, 1);
    }
    historyTabs.value.unshift(tab);
    // Keep only MAX_HISTORY items
    if (historyTabs.value.length > MAX_HISTORY) {
      historyTabs.value = historyTabs.value.slice(0, MAX_HISTORY);
    }
  }

  // Restore a tab from history (without adding to history again)
  function restoreTab(tab: Tab) {
    // Check if already open
    const existingTab = tabs.value.find(t => t.sessionId === tab.sessionId);
    if (existingTab) {
      // Just activate it
      activeTabId.value = existingTab.id;
      return;
    }

    // Add to current tabs without updating history
    tabs.value.push(tab);
    activeTabId.value = tab.id;
  }

  function removeTab(id: string) {
    const tab = tabs.value.find(t => t.id === id);
    if (tab) {
      // Remove from current tabs
      const index = tabs.value.findIndex(t => t.id === id);
      if (index !== -1) {
        tabs.value.splice(index, 1);
      }
      keySenders.delete(id);
      removeTabCwd(id);

      // Also remove from history (by sessionId)
      if (tab.sessionId) {
        const historyIndex = historyTabs.value.findIndex(t => t.sessionId === tab.sessionId);
        if (historyIndex !== -1) {
          historyTabs.value.splice(historyIndex, 1);
        }
      }

      if (activeTabId.value === id) {
        activeTabId.value = tabs.value[0]?.id || null;
      }
    }

    // Update session storage
    if (tabs.value.length === 0) {
      clearSessionData();
    }
  }

  function setActiveTab(id: string) {
    activeTabId.value = id;
  }

  // Update tab's sessionId (called when session is created)
  function updateTabSessionId(tabId: string, sessionId: string) {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.sessionId = sessionId;
      // Also update in history - find by id, not by agentId
      const historyTab = historyTabs.value.find(t => t.id === tabId);
      if (historyTab) {
        historyTab.sessionId = sessionId;
      }
    }
  }

  // Remove from history by sessionId
  function removeHistoryBySessionId(sessionId: string) {
    const index = historyTabs.value.findIndex(t => t.sessionId === sessionId);
    if (index !== -1) {
      historyTabs.value.splice(index, 1);
    }
  }

  function setAgents(list: typeof agents.value) {
    agents.value = list;
  }

  // Register a key sender for a tab
  function registerKeySender(tabId: string, sender: KeySender) {
    keySenders.set(tabId, sender);
  }

  // Unregister a key sender
  function unregisterKeySender(tabId: string) {
    keySenders.delete(tabId);
  }

  // Send a key to the active tab
  function sendKeyToActive(key: string) {
    if (activeTabId.value) {
      const sender = keySenders.get(activeTabId.value);
      if (sender) {
        sender(key);
      }
    }
  }

  // Focus the active tab's terminal
  function focusActiveTab() {
    if (activeTabId.value) {
      const focuser = tabFocusers.get(activeTabId.value);
      if (focuser) {
        focuser();
      }
    }
  }

  // Scroll active tab's terminal to bottom
  function scrollActiveTabToBottom() {
    if (activeTabId.value) {
      const scroller = tabScrollers.get(activeTabId.value);
      if (scroller) {
        scroller();
      }
    }
  }

  // Registry for tab focus functions
  const tabFocusers = new Map<string, () => void>();

  // Registry for tab scroll functions
  const tabScrollers = new Map<string, () => void>();

  // Registry for tab fit functions (called on viewport resize)
  const tabFitters = new Map<string, () => void>();

  // Register a focus function for a tab
  function registerTabFocuser(tabId: string, focuser: () => void) {
    tabFocusers.set(tabId, focuser);
  }

  // Register a scroll to bottom function for a tab
  function registerTabScroller(tabId: string, scroller: () => void) {
    tabScrollers.set(tabId, scroller);
  }

  // Unregister a focus function
  function unregisterTabFocuser(tabId: string) {
    tabFocusers.delete(tabId);
  }

  // Unregister a scroll function
  function unregisterTabScroller(tabId: string) {
    tabScrollers.delete(tabId);
  }

  // Register a fit function for a tab
  function registerTabFitter(tabId: string, fitter: () => void) {
    tabFitters.set(tabId, fitter);
  }

  // Unregister a fit function
  function unregisterTabFitter(tabId: string) {
    tabFitters.delete(tabId);
  }

  // Fit the active tab's terminal
  function fitActiveTab() {
    if (activeTabId.value) {
      const fitter = tabFitters.get(activeTabId.value);
      if (fitter) {
        fitter();
      }
    }
  }

  // Get the last active tab from saved session (for page refresh)
  function getLastActiveTab(): Tab | null {
    const session = loadSessionData();
    if (session && session.activeTabId) {
      return session.tabs.find(t => t.id === session.activeTabId) || null;
    }
    return null;
  }

  // Get the active tab's agentId from either Pinia store or sessionStorage fallback
  // [debug-loop] fix: handles case where Pinia tabs array appears empty
  function getActiveTabAgentId(): string | null {
    // Try Pinia store first
    const activeTab = tabs.value.find(t => t.id === activeTabId.value);
    if (activeTab) return activeTab.agentId;
    // Fallback to sessionStorage
    try {
      const session = loadSessionData();
      if (session?.activeTabId && session.tabs) {
        const storedTab = session.tabs.find(t => t.id === session.activeTabId);
        if (storedTab) return storedTab.agentId;
      }
    } catch {}
    return null;
  }

  // Get the most recent history tab (for login restore)
  function getLastHistoryTab(): Tab | null {
    return historyTabs.value[0] || null;
  }

  // Get all session tabs for multi-session restoration (page refresh)
  function getAllSessionTabs(): Tab[] {
    const session = loadSessionData();
    return session?.tabs || [];
  }

  // Get all history tabs for multi-session restoration (login)
  function getAllHistoryTabsForRestore(): Tab[] {
    return historyTabs.value;
  }

  // Get the stored active tab ID (for preserving active tab after restoration)
  function getStoredActiveTabId(): string | null {
    const session = loadSessionData();
    return session?.activeTabId || null;
  }

  // Set the CWD for a specific tab
  // [debug-loop] fix: persist tabCwd change to sessionStorage immediately
  function setTabCwd(tabId: string, cwd: string) {
    tabCwd[tabId] = cwd;
    // Persist immediately since the watch only watches tabs/activeTabId
    saveSessionData({
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      tabCwd: { ...tabCwd },
    });
  }

  // Lock CWD for a tab (called after cd detection handler sets CWD)
  // Prevents stale PS prompts from session:resume from overwriting correct CWD
  function lockTabCwd(tabId: string) {
    tabCwdLocked.add(tabId);
  }

  // Check if CWD is locked for a tab
  function isTabCwdLocked(tabId: string): boolean {
    return tabCwdLocked.has(tabId);
  }

  // Unlock CWD for a tab (called when new session is created)
  function unlockTabCwd(tabId: string) {
    tabCwdLocked.delete(tabId);
  }

  // Get the CWD for a specific tab
  function getTabCwd(tabId: string): string | undefined {
    return tabCwd[tabId];
  }

  // Registry for buffer parsers (tabId -> function that returns CWD from terminal buffer)
  const bufferParsers = new Map<string, () => string | null>();

  // Register a CWD-from-buffer parser for a tab
  function registerBufferParser(tabId: string, parser: () => string | null) {
    bufferParsers.set(tabId, parser);
  }

  // Unregister a buffer parser
  function unregisterBufferParser(tabId: string) {
    bufferParsers.delete(tabId);
  }

  // Get the CWD of the active tab (store first, then buffer fallback)
  // [debug-loop] fix: fallback to sessionStorage when Pinia state appears empty
  // (can happen when FileView mounts via full page load before TerminalView restores session)
  function getActiveTabCwd(): string | undefined {
    if (activeTabId.value) {
      const stored = tabCwd[activeTabId.value];
      if (stored) return stored;
      // Fallback: parse from terminal buffer directly
      const parser = bufferParsers.get(activeTabId.value);
      if (parser) {
        const fromBuffer = parser();
        if (fromBuffer) {
          // Cache it so future calls return the same value
          tabCwd[activeTabId.value] = fromBuffer;
          return fromBuffer;
        }
      }
    }
    // Pinia state fallback: read tabCwd directly from sessionStorage
    // This handles the case where Pinia store appears empty (e.g. full page load)
    try {
      const sessionData = loadSessionData();
      if (sessionData?.tabCwd) {
        const entries = Object.entries(sessionData.tabCwd);
        if (entries.length > 0) {
          // Return the most recently set CWD
          const [_tabId, cwd] = entries[entries.length - 1];
          // Also restore to Pinia state for future calls
          if (sessionData.activeTabId && sessionData.tabCwd[sessionData.activeTabId]) {
            tabCwd[sessionData.activeTabId] = sessionData.tabCwd[sessionData.activeTabId];
            return sessionData.tabCwd[sessionData.activeTabId];
          }
          return cwd;
        }
      }
    } catch {}
    return undefined;
  }

  // Remove CWD for a tab (called when tab is closed)
  // [debug-loop] fix: persist removal to sessionStorage
  function removeTabCwd(tabId: string) {
    delete tabCwd[tabId];
    tabCwdLocked.delete(tabId);
    saveSessionData({
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      tabCwd: { ...tabCwd },
    });
  }

  // Clear current session only (used on logout, but keep history)
  function clearCurrentSession() {
    tabs.value = [];
    activeTabId.value = null;
    keySenders.clear();
    clearSessionData();
  }

  // Clear all data including history
  function clearAll() {
    tabs.value = [];
    activeTabId.value = null;
    historyTabs.value = [];
    capturedCommands.value = [];
    shortcuts.value = [];
    keySenders.clear();
    clearSessionData();
    clearCapturedCommandsStorage();
    if (currentUsername) {
      clearHistoryData(currentUsername);
      clearShortcutsData(currentUsername);
    }
  }

  // Capture a command from terminal
  function captureCommand(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return; // Skip empty commands
    capturedCommands.value.push({
      text: trimmed,
      timestamp: Date.now(),
    });
    // Keep only MAX_CAPTURED_COMMANDS items
    if (capturedCommands.value.length > MAX_CAPTURED_COMMANDS) {
      capturedCommands.value = capturedCommands.value.slice(-MAX_CAPTURED_COMMANDS);
    }
  }

  // Clear captured commands for current session
  function clearCapturedCommands() {
    capturedCommands.value = [];
    clearCapturedCommandsStorage();
  }

  // Save a new shortcut
  function saveShortcut(name: string, commands: string[], agentId: string): boolean {
    if (!name.trim() || commands.length === 0 || !agentId || commands.some(c => !c.trim())) return false;

    const shortcut: Shortcut = {
      id: 'shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11),
      name: name.trim(),
      commands,
      agentId,
      createdAt: Date.now(),
    };

    // Add to beginning, keep max MAX_SHORTCUTS
    shortcuts.value.unshift(shortcut);
    if (shortcuts.value.length > MAX_SHORTCUTS) {
      shortcuts.value = shortcuts.value.slice(0, MAX_SHORTCUTS);
    }

    return true;
  }

  // Delete a shortcut
  function deleteShortcut(id: string) {
    const index = shortcuts.value.findIndex(s => s.id === id);
    if (index !== -1) {
      shortcuts.value.splice(index, 1);
    }
  }

  return {
    tabs,
    activeTabId,
    agents,
    historyTabs,
    capturedCommands,
    shortcuts,
    initUserData,
    getUsername,
    addTab,
    restoreTab,
    removeTab,
    removeHistoryBySessionId,
    setActiveTab,
    updateTabSessionId,
    setAgents,
    registerKeySender,
    unregisterKeySender,
    sendKeyToActive,
    focusActiveTab,
    scrollActiveTabToBottom,
    registerTabFocuser,
    unregisterTabFocuser,
    registerTabScroller,
    unregisterTabScroller,
    registerTabFitter,
    unregisterTabFitter,
    fitActiveTab,
    getLastActiveTab,
    getActiveTabAgentId,
    getLastHistoryTab,
    getAllSessionTabs,
    getAllHistoryTabsForRestore,
    getStoredActiveTabId,
    clearCurrentSession,
    clearAll,
    captureCommand,
    clearCapturedCommands,
    saveShortcut,
    deleteShortcut,
    setTabCwd,
    getTabCwd,
    getActiveTabCwd,
    removeTabCwd,
    registerBufferParser,
    unregisterBufferParser,
    lockTabCwd,
    isTabCwdLocked,
    unlockTabCwd,
  };
});