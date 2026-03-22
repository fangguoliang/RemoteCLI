import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

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
}

const SESSION_KEY = 'ccremote-terminal-session';
const HISTORY_KEY = 'ccremote-terminal-history';
const CAPTURED_KEY = 'ccremote-captured-commands';
const SHORTCUTS_KEY = 'ccremote-shortcuts';
const MAX_HISTORY = 10;
const MAX_SHORTCUTS = 10;
const MAX_CAPTURED_COMMANDS = 100;

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

// History storage (persistent, survives browser close)
function loadHistoryData(): Tab[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
  return [];
}

function saveHistoryData(tabs: Tab[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(tabs));
  } catch (e) {
    console.error('Failed to save history:', e);
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

// Shortcuts storage (persistent)
function loadShortcuts(): Shortcut[] {
  try {
    const data = localStorage.getItem(SHORTCUTS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load shortcuts:', e);
  }
  return [];
}

function saveShortcuts(shortcuts: Shortcut[]): void {
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch (e) {
    console.error('Failed to save shortcuts:', e);
  }
}

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<Tab[]>([]);
  const activeTabId = ref<string | null>(null);
  const agents = ref<{ agentId: string; name: string; online: boolean }[]>([]);
  const historyTabs = ref<Tab[]>(loadHistoryData());
  const capturedCommands = ref<CapturedCommand[]>(loadCapturedCommands());
  const shortcuts = ref<Shortcut[]>(loadShortcuts());

  // Registry for key senders (tabId -> sendKey function)
  const keySenders = new Map<string, KeySender>();

  // Watch for changes and auto-save session
  watch(
    [tabs, activeTabId],
    () => {
      if (tabs.value.length > 0) {
        saveSessionData({
          tabs: tabs.value,
          activeTabId: activeTabId.value,
        });
      }
    },
    { deep: true }
  );

  // Watch history and auto-save to localStorage
  watch(
    historyTabs,
    () => {
      saveHistoryData(historyTabs.value);
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

  // Watch shortcuts and auto-save to localStorage
  watch(
    shortcuts,
    () => {
      saveShortcuts(shortcuts.value);
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

  // Get the last active tab from saved session (for page refresh)
  function getLastActiveTab(): Tab | null {
    const session = loadSessionData();
    if (session && session.activeTabId) {
      return session.tabs.find(t => t.id === session.activeTabId) || null;
    }
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
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(SHORTCUTS_KEY);
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
    getLastActiveTab,
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
  };
});