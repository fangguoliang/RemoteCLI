import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Tab {
  id: string;
  title: string;
  agentId: string;
}

// Key sender function type
type KeySender = (key: string) => void;

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<Tab[]>([]);
  const activeTabId = ref<string | null>(null);
  const agents = ref<{ agentId: string; name: string; online: boolean }[]>([]);

  // Registry for key senders (tabId -> sendKey function)
  const keySenders = new Map<string, KeySender>();

  function addTab(tab: Tab) {
    tabs.value.push(tab);
    activeTabId.value = tab.id;
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
  }

  function setActiveTab(id: string) {
    activeTabId.value = id;
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

  return {
    tabs,
    activeTabId,
    agents,
    addTab,
    removeTab,
    setActiveTab,
    setAgents,
    registerKeySender,
    unregisterKeySender,
    sendKeyToActive,
  };
});