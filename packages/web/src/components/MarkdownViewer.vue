<template>
  <Teleport to="body">
    <div v-if="visible" class="markdown-viewer-overlay">
      <!-- Header -->
      <div class="viewer-header">
        <button class="back-btn" @click="handleClose">←</button>
        <span class="file-name">{{ fileName }}</span>
        <button class="save-btn" @click="handleSave" :disabled="saving">
          {{ saving ? '同步中...' : '保存' }}
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
        <span v-if="!isEditMode">← 左滑进入编辑模式</span>
        <span v-else>右滑返回预览模式 →</span>
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
const saving = computed(() => store.viewerSaving);
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

  // Check WebSocket connection
  if (!fileWebSocket.isConnected()) {
    showErrorToast('未连接到服务器，请稍后重试');
    return;
  }

  store.setViewerSaving(true);

  // Upload content back to agent
  // Convert text to base64
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  // Send as upload (reuse existing upload mechanism)
  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);
  const totalSize = bytes.length;

  // Add transfer to track progress
  store.addTransfer({
    id: filePath.value,
    path: filePath.value,
    fileName: fileName.value,
    direction: 'upload',
    percent: 0,
    status: 'in_progress',
  });

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, base64.length);
    const chunk = base64.substring(start, end);

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

// Watch for upload completion
watch(() => store.transfers.find(t => t.path === filePath.value)?.status, (status) => {
  if (status === 'completed') {
    store.setViewerSaving(false);
    showSuccessToast('已同步到 Agent');
    // Clean up transfer after success
    setTimeout(() => store.removeTransfer(filePath.value), 100);
  } else if (status === 'error') {
    store.setViewerSaving(false);
    showErrorToast('同步失败，请重试');
    // Clean up transfer after error
    setTimeout(() => store.removeTransfer(filePath.value), 100);
  }
});

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
  background: #1E1E1E;
  display: flex;
  flex-direction: column;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #252526;
  border-bottom: 1px solid #3C3C3C;
  flex-shrink: 0;
}

.back-btn, .save-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.back-btn {
  background: transparent;
  color: #e0e0e0;
}

.save-btn {
  background: rgba(76, 175, 80, 0.15);
  border: 1px solid rgba(76, 175, 80, 0.3);
  color: #4CAF50;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-name {
  color: #D4D4D4;
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
  background: #1E1E1E;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #3C3C3C;
  border-top-color: #FF8E53;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.hint-bar {
  padding: 8px;
  text-align: center;
  background: #252526;
  border-top: 1px solid #3C3C3C;
  color: #8B92A5;
  font-size: 12px;
}

.toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: rgba(76, 175, 80, 0.9);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  z-index: 1001;
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