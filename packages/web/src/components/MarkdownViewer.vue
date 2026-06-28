<template>
  <Teleport to="body">
    <div v-if="visible" class="markdown-viewer-overlay">
      <!-- Header -->
      <div class="viewer-header">
        <button class="back-btn" @click="handleClose">←</button>
        <span class="file-name">{{ fileName }}</span>
        <button class="save-btn" @click="handleSave" :disabled="saving">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>

      <!-- Content -->
      <div ref="contentRef" class="viewer-content" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
        <div v-if="loading" class="loading-overlay">
          <div class="spinner"></div>
        </div>
        <!-- 预览模式 -->
        <MdPreview
          v-else-if="!isEditMode"
          :modelValue="content"
          theme="dark"
          style="height: 100%; overflow: auto;"
        />
        <!-- 编辑模式 -->
        <MdEditor
          v-else
          v-model="content"
          theme="dark"
          style="height: 100%"
        />
      </div>

      <!-- Hint bar -->
      <div class="hint-bar">
        <span v-if="!isEditMode">← Swipe left to edit</span>
        <span v-else>Swipe right to preview →</span>
      </div>

      <!-- Toast -->
      <Transition name="fade">
        <div v-if="showToast" class="toast" :class="{ 'toast-error': isErrorToast }">{{ toastMessage }}</div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { useFileStore } from '@/stores/file';
import { fileWebSocket } from '@/services/fileWebSocket';
import { blackbox } from '@/utils/eventLogger';

const router = useRouter();
const store = useFileStore();

// Close markdown viewer when navigating away from terminal
router.afterEach(() => {
  if (store.viewerVisible) {
    fileWebSocket.cancelViewing();
    store.clearViewer();
  }
});

const visible = computed(() => store.viewerVisible);
const loading = computed(() => store.viewerLoading);
const saving = ref(false);
const storeContent = computed(() => store.viewerContent);
const filePath = computed(() => store.viewerPath);

const content = ref('');
const isEditMode = ref(false);
const showToast = ref(false);
const toastMessage = ref('');
const isErrorToast = ref(false);

// [swipe-nav-fix] Push a history state when viewer opens to trap browser swipe-back gesture.
let viewerHistoryPushed = false;

function onPopStateCloseViewer() {
  if (viewerHistoryPushed && store.viewerVisible) {
    viewerHistoryPushed = false;
    handleClose();
    // Signal to FileView's popstate handler that we handled this swipe-back
    (window as any).__swipeBackHandled = true;
    setTimeout(() => { (window as any).__swipeBackHandled = false; }, 100);
  }
}

window.addEventListener('popstate', onPopStateCloseViewer);

watch(visible, (v) => {
  if (v && !viewerHistoryPushed) {
    history.pushState({ markdownViewer: true }, '');
    viewerHistoryPushed = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopStateCloseViewer);
});
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

const fileName = computed(() => {
  const path = filePath.value;
  return path ? path.split(/[/\\]/).pop() || path : 'file.md';
});

// Sync content from store (immediate for initial content)
watch(storeContent, (newContent) => {
  content.value = newContent;
}, { immediate: true });

// Swipe gesture handling — strict thresholds to avoid conflicts with md-editor toolbar
let touchStartX = 0;
let touchStartY = 0;
let touchStartTarget: HTMLElement | null = null;
const contentRef = ref<HTMLElement | null>(null);

// Non-passive touchmove to prevent browser horizontal swipe navigation
function onTouchStartCapture(e: TouchEvent) {
  touchStartTarget = e.target as HTMLElement;
  blackbox.log('mdview-touch', 'mdviewer:touchstart', {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY,
    targetClass: touchStartTarget?.className?.slice(0, 50) || 'unknown',
    isToolbar: !!touchStartTarget?.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper'),
    isScrollable: !!touchStartTarget?.closest('.md-editor, .md-editor-preview-wrap'),
  });
}

function onTouchMove(e: TouchEvent) {
  const dx = Math.abs(e.touches[0].clientX - touchStartX);
  const dy = Math.abs(e.touches[0].clientY - touchStartY);
  const isHorizontal = dx > dy;

  // For toolbar: still prevent horizontal swipe that would trigger browser navigation
  if (touchStartTarget?.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper')) {
    if (isHorizontal && dx > 10) {
      e.preventDefault();
      blackbox.log('mdview-touch', 'mdviewer:touchmove-blocked-toolbar', { dx, dy, prevented: true });
    }
    return;
  }
  // For scrollable content: still prevent horizontal swipe
  if (touchStartTarget?.closest('.md-editor, .md-editor-preview-wrap')) {
    if (isHorizontal && dx > 10) {
      e.preventDefault();
      blackbox.log('mdview-touch', 'mdviewer:touchmove-blocked-content', { dx, dy, prevented: true });
    }
    return;
  }
  if (isHorizontal && dx > 10) {
    e.preventDefault();
    blackbox.log('mdview-touch', 'mdviewer:touchmove-blocked-other', { dx, dy, prevented: true });
  }
}

function onTouchEndCapture(e: TouchEvent) {
  blackbox.log('mdview-touch', 'mdviewer:touchend', {
    targetClass: touchStartTarget?.className?.slice(0, 50) || 'unknown',
    changedTouches: e.changedTouches.length,
  });
}

onMounted(() => {
  contentRef.value?.addEventListener('touchstart', onTouchStartCapture, { passive: true, capture: true });
  contentRef.value?.addEventListener('touchmove', onTouchMove, { passive: false });
  contentRef.value?.addEventListener('touchend', onTouchEndCapture, { passive: true, capture: true });
});

onBeforeUnmount(() => {
  contentRef.value?.removeEventListener('touchstart', onTouchStartCapture, { capture: true });
  contentRef.value?.removeEventListener('touchmove', onTouchMove);
  contentRef.value?.removeEventListener('touchend', onTouchEndCapture, { capture: true });
});

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e: TouchEvent) {
  // Skip swipe if touch started on toolbar or scrollable content
  const target = touchStartTarget || (e.target as HTMLElement);
  if (target.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper')) return;
  if (target.closest('.md-editor, .md-editor-preview-wrap')) return;
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  const deltaX = touchEndX - touchStartX;
  const deltaY = Math.abs(touchEndY - touchStartY);

  // Must be primarily horizontal: |dx| > 2 * |dy| and > 100px
  if (Math.abs(deltaX) > 100 && Math.abs(deltaX) > deltaY * 2) {
    if (deltaX < 0) {
      // Swipe left → edit mode
      isEditMode.value = true;
    } else {
      // Swipe right → preview mode
      isEditMode.value = false;
    }
  }
}

function handleClose() {
  // Clean up any pending toast
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  fileWebSocket.cancelViewing();
  store.clearViewer();
  isEditMode.value = false;
}

function handleSave() {
  if (saving.value) return;

  if (!fileWebSocket.isConnected()) {
    showErrorToast('Not connected');
    return;
  }

  saving.value = true;

  // Send upload directly, no transfer tracking
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);
  const totalSize = bytes.length;

  // Listen for file:uploaded to detect completion
  const handleUploaded = (data: unknown) => {
    const payload = data as { path: string; success: boolean; error?: string };
    if (payload.path === filePath.value) {
      if (payload.success) {
        showSuccessToast('Saved');
      } else {
        showErrorToast('Save failed, retry');
      }
      saving.value = false;
      clearTimeout(saveTimeout);
      fileWebSocket.off('file:uploaded', handleUploaded);
    }
  };
  fileWebSocket.on('file:uploaded', handleUploaded);

  // Timeout: if no response in 30s, clean up
  const saveTimeout = setTimeout(() => {
    fileWebSocket.off('file:uploaded', handleUploaded);
    saving.value = false;
    showErrorToast('Save timeout, retry');
  }, 30000);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64.substring(i * chunkSize, Math.min((i + 1) * chunkSize, base64.length));
    fileWebSocket.sendMessage({
      type: 'file:upload',
      payload: {
        path: filePath.value,
        content: chunk,
        chunkIndex: i,
        totalChunks,
        totalSize,
        overwrite: true,
      },
      timestamp: Date.now(),
    });
  }
}

function showSuccessToast(message: string) {
  isErrorToast.value = false;
  toastMessage.value = message;
  showToast.value = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    showToast.value = false;
    toastTimeout = null;
  }, 3000);
}

function showErrorToast(message: string) {
  isErrorToast.value = true;
  toastMessage.value = message;
  showToast.value = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    showToast.value = false;
    toastTimeout = null;
  }, 3000);
}

// Clean up on unmount
onUnmounted(() => {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
});
</script>

<style scoped>
.markdown-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg-root);
  display: flex;
  flex-direction: column;
  /* touch-action removed - was 'none' which blocked vertical scrolling via CSS inheritance.
     Horizontal swipe prevention is handled by JS touchmove preventDefault handler. */
}

/* Do NOT set touch-action on content elements - let MdEditor's internal touch-action: none
   block swipe-back at root level, while the browser detects overflow:auto child for vertical scroll. */
.markdown-viewer-overlay .md-editor,
.markdown-viewer-overlay .md-editor-preview-wrap,
.markdown-viewer-overlay .md-editor .md-editor-preview {
  overscroll-behavior: none;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.back-btn, .save-btn {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  cursor: pointer;
  transition: background var(--transition-fast), opacity var(--transition-fast);
  min-height: 44px;
}

.back-btn {
  background: transparent;
  color: var(--text-primary);
  touch-action: manipulation; /* Ensure click fires even when parent has touch-action: none */
}

.back-btn:hover {
  background: var(--bg-surface-hover);
}

.save-btn {
  background: rgba(76, 175, 80, 0.15);
  border: 1px solid rgba(76, 175, 80, 0.3);
  color: var(--success);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-name {
  color: var(--text-primary);
  font-size: 14px;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-root);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.hint-bar {
  padding: var(--space-2);
  text-align: center;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-strong);
  color: var(--text-muted);
  font-size: 12px;
}

.toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-3) var(--space-6);
  background: rgba(76, 175, 80, 0.9);
  color: #fff;
  border-radius: var(--radius-lg);
  font-size: 14px;
  z-index: 1001;
  box-shadow: var(--shadow-lg);
}

.toast-error {
  background: rgba(244, 67, 54, 0.9);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>

<style>
/* Global styles for md-editor-v3 dark theme */
.markdown-viewer-overlay .md-editor {
  --md-bk-color: #1E1E1E !important;
  background: #1E1E1E !important;
  height: 100% !important;
}

.markdown-viewer-overlay .md-editor-toolbar-wrapper {
  background: #252526 !important;
  border-bottom: 1px solid #3C3C3C !important;
}

/* Make toolbar horizontally scrollable on mobile */
.markdown-viewer-overlay .md-editor-toolbar,
.markdown-viewer-overlay .md-b-toolbar {
  overflow-x: auto !important;
  overflow-y: hidden !important;
  flex-wrap: nowrap !important;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  touch-action: pan-x; /* allow horizontal scroll, block browser swipe navigation */
}
.markdown-viewer-overlay .md-editor-toolbar::-webkit-scrollbar,
.markdown-viewer-overlay .md-b-toolbar::-webkit-scrollbar {
  display: none;
}

.markdown-viewer-overlay .md-editor-content {
  background: #1E1E1E !important;
}

.markdown-viewer-overlay .md-editor-input {
  background: #1E1E1E !important;
  color: #D4D4D4 !important;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace !important;
}

.markdown-viewer-overlay .md-editor-preview {
  background: #252526 !important;
  color: #D4D4D4 !important;
}

.markdown-viewer-overlay .md-editor-preview h1,
.markdown-viewer-overlay .md-editor-preview h2,
.markdown-viewer-overlay .md-editor-preview h3,
.markdown-viewer-overlay .md-editor-preview h4,
.markdown-viewer-overlay .md-editor-preview h5,
.markdown-viewer-overlay .md-editor-preview h6 {
  color: #FF8E53 !important;
  border-bottom-color: #3C3C3C !important;
}

.markdown-viewer-overlay .md-editor-preview code {
  background: #2D2D2D !important;
  color: #CE9178 !important;
}

.markdown-viewer-overlay .md-editor-preview pre {
  background: #2D2D2D !important;
  border: 1px solid #3C3C3C !important;
}

.markdown-viewer-overlay .md-editor-preview blockquote {
  border-left-color: #FF8E53 !important;
  background: rgba(255, 142, 83, 0.1) !important;
  color: #B8C1EC !important;
}
</style>