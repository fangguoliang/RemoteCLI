import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface Tab {
  id: string;
  title: string;
  agentId: string;
  createdAt: number;
  sessionId?: string; // Optional: used for session persistence
}

interface StoredSession {
  tabs: Tab[];
  activeTabId: string | null;
}

const SESSION_KEY = 'ccremote-terminal-session';
const HISTORY_KEY = 'ccremote-terminal-history';
const MAX_HISTORY = 10;

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

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<Tab[]>([]);
  const activeTabId = ref<string | null>(null);
  const agents = ref<{ agentId: string; name: string; online: boolean }[]>([]);
  const historyTabs = ref<Tab[]>(loadHistoryData());

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

  function removeTab(id: string) {
    const index = tabs.value.findIndex(t => t.id === id);
    if (index !== -1) {
      tabs.value.splice(index, 1);
      keySenders.delete(id);
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
    keySenders.clear();
    clearSessionData();
    localStorage.removeItem(HISTORY_KEY);
  }

  return {
    tabs,
    activeTabId,
    agents,
    historyTabs,
    addTab,
    removeTab,
    setActiveTab,
    updateTabSessionId,
    setAgents,
    registerKeySender,
    unregisterKeySender,
    sendKeyToActive,
    getLastActiveTab,
    getLastHistoryTab,
    clearCurrentSession,
    clearAll,
  };
});