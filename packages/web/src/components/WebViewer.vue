<template>
  <!-- Fullscreen viewer -->
  <div
    v-if="webViewerStore.state === 'fullscreen'"
    class="web-viewer fullscreen"
    :class="{ landscape: webViewerStore.isLandscape }"
  >
    <!-- Portrait layout: header top, controls bottom -->
    <template v-if="!webViewerStore.isLandscape">
      <div class="viewer-header">
        <button class="btn-minimize" @click="minimize">—</button>
        <span class="viewer-title">{{ displayUrl }}</span>
        <button class="btn-close" @click="close">×</button>
      </div>
      <div class="viewer-content">
        <iframe
          ref="iframeRef"
          :src="webViewerStore.proxyUrl ?? undefined"
          :style="iframeStyle"
          frameborder="0"
          allowfullscreen
        ></iframe>
      </div>
      <div class="viewer-controls">
        <button
          :class="{ active: webViewerStore.viewport === 'mobile' }"
          @click="setViewport('mobile')"
        >📱 手机</button>
        <button
          :class="{ active: webViewerStore.viewport === 'tablet' }"
          @click="setViewport('tablet')"
        >📋 平板</button>
        <button
          :class="{ active: webViewerStore.viewport === 'desktop' }"
          @click="setViewport('desktop')"
        >🖥 桌面</button>
      </div>
    </template>

    <!-- Landscape layout: controls on right side -->
    <template v-else>
      <div class="viewer-content landscape-content">
        <iframe
          ref="iframeRef"
          :src="webViewerStore.proxyUrl ?? undefined"
          :style="iframeStyle"
          frameborder="0"
          allowfullscreen
        ></iframe>
      </div>
      <div class="viewer-controls landscape-controls">
        <button class="btn-minimize" @click="minimize">—</button>
        <button
          :class="{ active: webViewerStore.viewport === 'mobile' }"
          @click="setViewport('mobile')"
        >📱</button>
        <button
          :class="{ active: webViewerStore.viewport === 'tablet' }"
          @click="setViewport('tablet')"
        >📋</button>
        <button
          :class="{ active: webViewerStore.viewport === 'desktop' }"
          @click="setViewport('desktop')"
        >🖥</button>
        <button class="btn-close" @click="close">×</button>
      </div>
    </template>
  </div>

  <!-- Minimized floating bar -->
  <div
    v-if="webViewerStore.state === 'minimized'"
    class="web-viewer minimized-bar"
  >
    <span class="minimized-title">🌐 {{ displayUrl }}</span>
    <button class="btn-restore" @click="restore">恢复</button>
    <button class="btn-close-minimized" @click="close">×</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWebViewerStore, type ViewportType } from '../stores/webViewer';

const webViewerStore = useWebViewerStore();
const iframeRef = ref<HTMLIFrameElement | null>(null);

// Display URL (truncate if too long)
const displayUrl = computed(() => {
  const url = webViewerStore.url || '';
  return url.length > 30 ? url.substring(0, 30) + '...' : url;
});

// iframe style for scaling in landscape mode
const iframeStyle = computed(() => {
  if (!webViewerStore.isLandscape) {
    // Portrait: actual size display (fit to container)
    return {
      width: '100%',
      height: '100%',
    };
  }

  // Landscape: scaled to fit screen
  const viewport = webViewerStore.currentViewportSize;
  const controlBarWidth = 48;
  const screenWidth = window.innerWidth - controlBarWidth;
  const screenHeight = window.innerHeight;

  // Calculate scale ratio
  const scaleX = screenWidth / viewport.width;
  const scaleY = screenHeight / viewport.height;
  const scale = Math.min(scaleX, scaleY);

  return {
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  };
});

// Viewport switching with fullscreen control
async function setViewport(viewport: ViewportType) {
  webViewerStore.setViewport(viewport);

  if (webViewerStore.VIEWPORTS[viewport].orientation === 'landscape') {
    await enterFullscreenLandscape();
  } else {
    await exitFullscreen();
  }
}

// Enter landscape fullscreen mode
async function enterFullscreenLandscape() {
  try {
    await document.documentElement.requestFullscreen();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orientation = screen.orientation as any;
    if (orientation?.lock) {
      await orientation.lock('landscape');
    }
  } catch {
    // Browser doesn't support, ignore
  }
}

// Exit fullscreen mode
async function exitFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orientation = screen.orientation as any;
  if (orientation?.unlock) {
    orientation.unlock();
  }
}

// Minimize (preserve iframe)
function minimize() {
  webViewerStore.setMinimized();
  exitFullscreen();
}

// Restore from minimized state
async function restore() {
  webViewerStore.setVisible(true);
  if (webViewerStore.isLandscape) {
    await enterFullscreenLandscape();
  }
}

// Close (release resources)
async function close() {
  await exitFullscreen();
  webViewerStore.clear();
}

// Watch for fullscreen changes
watch(() => webViewerStore.state, (newState, oldState) => {
  if (newState === 'fullscreen' && oldState !== 'minimized') {
    // Just opened - enter fullscreen if landscape
    if (webViewerStore.isLandscape) {
      enterFullscreenLandscape();
    }
  }
});
</script>

<style scoped>
.web-viewer {
  position: fixed;
  background: #1a1a2e;
  z-index: 1000;
}

/* Fullscreen mode */
.web-viewer.fullscreen {
  inset: 0;
  display: flex;
}

.web-viewer.fullscreen:not(.landscape) {
  flex-direction: column;
}

.web-viewer.fullscreen.landscape {
  flex-direction: row;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #16213e;
  color: #e0e0e0;
  height: 48px;
}

.viewer-title {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.landscape-content {
  flex: 1;
  overflow: auto;
  background: #0f0f23;
}

.viewer-content iframe {
  border: none;
  background: white;
}

.viewer-controls {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: #16213e;
}

.viewer-controls:not(.landscape-controls) {
  justify-content: center;
  height: 56px;
}

.landscape-controls {
  flex-direction: column;
  width: 48px;
  padding: 12px 8px;
  align-items: center;
  gap: 12px;
}

.viewer-controls button {
  background: #1a1a2e;
  border: 1px solid #4a4a6a;
  color: #e0e0e0;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.landscape-controls button {
  padding: 8px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-controls button.active {
  background: #e94560;
  border-color: #e94560;
}

.viewer-controls button:hover {
  background: #2a2a4e;
}

.btn-close, .btn-minimize {
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 20px;
  padding: 4px 8px;
  cursor: pointer;
}

.landscape-controls .btn-close {
  margin-top: auto;
}

.landscape-controls .btn-minimize {
  margin-bottom: 8px;
}

/* Minimized bar */
.minimized-bar {
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #16213e;
  border-top: 1px solid #4a4a6a;
  color: #e0e0e0;
}

.minimized-title {
  font-size: 14px;
}

.btn-restore {
  background: #e94560;
  border: none;
  color: white;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-close-minimized {
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 18px;
  cursor: pointer;
}
</style>