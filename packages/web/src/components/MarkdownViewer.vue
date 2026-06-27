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
      <div class="viewer-content" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
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
import { ref, computed, watch, onUnmounted } from 'vue';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { useFileStore } from '@/stores/file';
import { fileWebSocket } from '@/services/fileWebSocket';

const store = useFileStore();

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
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

const fileName = computed(() => {
  const path = filePath.value;
  return path ? path.split(/[/\\]/).pop() || path : 'file.md';
});

// Sync content from store (immediate for initial content)
watch(storeContent, (newContent) => {
  content.value = newContent;
}, { immediate: true });

// Swipe gesture handling
let touchStartX = 0;

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
}

function handleTouchEnd(e: TouchEvent) {
  const touchEndX = e.changedTouches[0].clientX;
  const deltaX = touchEndX - touchStartX;

  if (deltaX < -50) {
    // Swipe left → edit mode
    isEditMode.value = true;
  } else if (deltaX > 50) {
    // Swipe right → preview mode
    isEditMode.value = false;
  }
}

function handleClose() {
  // Clean up any pending toast
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
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
      fileWebSocket.off('file:uploaded', handleUploaded);
    }
  };
  fileWebSocket.on('file:uploaded', handleUploaded);

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