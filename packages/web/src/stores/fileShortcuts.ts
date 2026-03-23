import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface FileShortcut {
  id: string;
  name: string;
  path: string;
  agentId: string;
  createdAt: number;
}

const SHORTCUTS_KEY = 'remotecli-file-shortcuts';
const MAX_SHORTCUTS = 10;

function loadShortcuts(): FileShortcut[] {
  try {
    const data = localStorage.getItem(SHORTCUTS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load file shortcuts:', e);
  }
  return [];
}

function saveShortcuts(shortcuts: FileShortcut[]): void {
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch (e) {
    console.error('Failed to save file shortcuts:', e);
  }
}

export const useFileShortcutsStore = defineStore('fileShortcuts', () => {
  const shortcuts = ref<FileShortcut[]>(loadShortcuts());

  watch(
    shortcuts,
    () => {
      saveShortcuts(shortcuts.value);
    },
    { deep: true }
  );

  function saveShortcut(name: string, path: string, agentId: string): boolean {
    if (!name.trim() || !path.trim() || !agentId) return false;

    const shortcut: FileShortcut = {
      id: 'file-shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11),
      name: name.trim(),
      path: path.trim(),
      agentId,
      createdAt: Date.now(),
    };

    shortcuts.value.unshift(shortcut);
    if (shortcuts.value.length > MAX_SHORTCUTS) {
      shortcuts.value = shortcuts.value.slice(0, MAX_SHORTCUTS);
    }

    return true;
  }

  function deleteShortcut(id: string) {
    const index = shortcuts.value.findIndex(s => s.id === id);
    if (index !== -1) {
      shortcuts.value.splice(index, 1);
    }
  }

  function clearAll() {
    shortcuts.value = [];
  }

  return {
    shortcuts,
    saveShortcut,
    deleteShortcut,
    clearAll,
  };
});