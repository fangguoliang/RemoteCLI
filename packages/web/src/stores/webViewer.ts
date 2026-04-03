// packages/web/src/stores/webViewer.ts

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSettingsStore } from './settings';

export type ViewerState = 'closed' | 'fullscreen' | 'minimized';
export type ViewportType = 'mobile' | 'tablet' | 'desktop';

export interface ViewportSize {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

const VIEWPORTS: Record<ViewportType, ViewportSize> = {
  mobile: { width: 375, height: 667, orientation: 'portrait' },
  tablet: { width: 768, height: 1024, orientation: 'landscape' },
  desktop: { width: 1920, height: 1080, orientation: 'landscape' },
};

const PROXY_PORT = 8080;

export const useWebViewerStore = defineStore('webViewer', () => {
  // State
  const url = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const state = ref<ViewerState>('closed');
  const viewport = ref<ViewportType>('mobile');

  // Get server host from settings
  const settings = useSettingsStore();

  const serverHost = computed(() => {
    const apiUrl = settings.settings.apiUrl || '';
    // Derive host from apiUrl: "https://server.com/api" -> "server.com"
    const match = apiUrl.match(/^https?:\/\/([^:/]+)/);
    return match ? match[1] : window.location.hostname;
  });

  // Proxy URL calculation (URL-encoded)
  const proxyUrl = computed(() => {
    if (!url.value || !sessionId.value) return null;

    const encodedUrl = encodeURIComponent(url.value);
    return `http://${serverHost.value}:${PROXY_PORT}/proxy/${sessionId.value}/${encodedUrl}`;
  });

  // Check if current viewport is landscape
  const isLandscape = computed(() => {
    return VIEWPORTS[viewport.value].orientation === 'landscape';
  });

  // Get current viewport dimensions
  const currentViewportSize = computed(() => {
    return VIEWPORTS[viewport.value];
  });

  // Methods
  function setUrl(targetUrl: string | null) {
    url.value = targetUrl;
  }

  function setSessionId(sid: string | null) {
    sessionId.value = sid;
  }

  function setVisible(visible: boolean) {
    state.value = visible ? 'fullscreen' : 'closed';
  }

  function setMinimized() {
    state.value = 'minimized';
  }

  function setViewport(v: ViewportType) {
    viewport.value = v;
  }

  function clear() {
    url.value = null;
    sessionId.value = null;
    state.value = 'closed';
    viewport.value = 'mobile';
  }

  return {
    url,
    sessionId,
    state,
    viewport,
    proxyUrl,
    isLandscape,
    currentViewportSize,
    VIEWPORTS,
    setUrl,
    setSessionId,
    setVisible,
    setMinimized,
    setViewport,
    clear,
  };
});