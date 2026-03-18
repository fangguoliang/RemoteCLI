import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface Settings {
  apiUrl: string;
  theme: 'dark' | 'light';
  fontFamily: string;
  fontSize: number;
}

const DEFAULT_SETTINGS: Settings = {
  apiUrl: '',
  theme: 'dark',
  fontFamily: 'Consolas, monospace',
  fontSize: 14,
};

export const useSettingsStore = defineStore('settings', () => {
  const stored = localStorage.getItem('settings');
  const settings = ref<Settings>(stored ? JSON.parse(stored) : { ...DEFAULT_SETTINGS });

  watch(settings, (val) => {
    localStorage.setItem('settings', JSON.stringify(val));
  }, { deep: true });

  function updateSettings(partial: Partial<Settings>) {
    Object.assign(settings.value, partial);
  }

  function resetSettings() {
    settings.value = { ...DEFAULT_SETTINGS };
  }

  return { settings, updateSettings, resetSettings };
});