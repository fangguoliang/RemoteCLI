<template>
  <Teleport to="body">
    <Transition name="overlay-slide">
      <div v-if="overlay.visible.value" class="file-overlay" role="dialog" aria-modal="true" aria-label="File viewer" @keydown.esc="handleClose">
        <!-- Header -->
        <div class="overlay-header">
          <button class="back-btn" @click="handleClose">&larr;</button>
          <span class="file-name">{{ fileName }}</span>
          <div class="header-actions">
            <button v-if="canEdit && overlay.mode.value === 'view'" class="edit-btn" @click="overlay.setMode('edit')">Edit</button>
            <button v-if="overlay.mode.value === 'edit'" class="cancel-edit-btn" @click="handleCancelEdit">Cancel</button>
            <button v-if="overlay.mode.value === 'edit'" class="save-btn" @click="handleSave" :disabled="overlay.saving.value">
              {{ overlay.saving.value ? 'Saving...' : 'Save' }}
            </button>
            <button class="download-btn" @click="handleDownload">&darr;</button>
          </div>
        </div>

        <!-- Content -->
        <div class="overlay-content">
          <div v-if="overlay.loading.value" class="loading-spinner">
            <div class="spinner"></div>
          </div>

          <!-- Markdown preview/edit -->
          <template v-else-if="overlay.fileType.value === 'md'">
            <MdPreview v-if="overlay.mode.value === 'view'" :modelValue="overlay.content.value" theme="dark" class="overlay-md" />
            <MdEditor v-else v-model="overlay.content.value" theme="dark" class="overlay-md" @update:modelValue="onMdChange" />
          </template>

          <!-- Text/JSON preview/edit -->
          <template v-else-if="overlay.fileType.value === 'txt' || overlay.fileType.value === 'json'">
            <pre v-if="overlay.mode.value === 'view'" class="text-preview">{{ overlay.content.value || 'Empty file' }}</pre>
            <textarea v-else class="text-editor" :value="overlay.content.value" @input="onTextInput" spellcheck="false"></textarea>
          </template>

          <!-- HTML/PDF iframe -->
          <iframe v-else-if="overlay.fileType.value === 'html' || overlay.fileType.value === 'pdf'"
            :src="iframeSrc" class="iframe-viewer" sandbox="allow-same-origin"></iframe>

          <!-- Image -->
          <div v-else-if="overlay.fileType.value === 'image'" class="image-viewer">
            <img :src="imageSrc" :alt="fileName" @error="onImageError" />
          </div>
        </div>

        <!-- Toast -->
        <Transition name="fade">
          <div v-if="showToast" class="toast" :class="{ 'toast-error': isErrorToast }">{{ toastMessage }}</div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { useFileOverlay } from '@/composables/useFileOverlay';
import { fileWebSocket } from '@/services/fileWebSocket';

const overlay = useFileOverlay();
const showToast = ref(false);
const toastMessage = ref('');
const isErrorToast = ref(false);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

const fileName = computed(() => {
  const p = overlay.path.value;
  return p ? p.split(/[/\\]/).pop() || p : '';
});

const canEdit = computed(() => {
  const type = overlay.fileType.value;
  return type === 'md' || type === 'txt' || type === 'json';
});

const iframeSrc = computed(() => {
  if (overlay.fileType.value === 'html') {
    return `data:text/html;charset=utf-8,${encodeURIComponent(overlay.content.value)}`;
  }
  if (overlay.fileType.value === 'pdf') {
    return `data:application/pdf;base64,${overlay.content.value}`;
  }
  return '';
});

const imageSrc = computed(() => {
  if (overlay.fileType.value !== 'image') return '';
  return `data:image;base64,${overlay.content.value}`;
});

function onMdChange(val: string) {
  overlay.updateContent(val);
}

function onTextInput(e: Event) {
  const target = e.target as HTMLTextAreaElement;
  overlay.updateContent(target.value);
}

function onImageError() {
  showErrorToast('Failed to load image');
}

function handleClose() {
  if (overlay.dirty.value && overlay.mode.value === 'edit') {
    if (!confirm('Discard changes?')) return;
  }
  overlay.close();
}

function handleCancelEdit() {
  if (overlay.dirty.value) {
    if (!confirm('Discard changes?')) return;
  }
  overlay.setMode('view');
}

function handleDownload() {
  fileWebSocket.download(overlay.path.value);
}

function handleSave() {
  if (overlay.saving.value) return;
  if (!fileWebSocket.isConnected()) {
    showErrorToast('Not connected');
    return;
  }

  overlay.saving.value = true;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(overlay.content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);

  const handleUploaded = (data: unknown) => {
    const payload = data as { path: string; success: boolean };
    if (payload.path === overlay.path.value) {
      if (payload.success) {
        showSuccessToast('Saved');
        overlay.dirty.value = false;
        overlay.setMode('view');
      } else {
        showErrorToast('Save failed, retry');
      }
      overlay.saving.value = false;
      fileWebSocket.off('file:uploaded', handleUploaded);
    }
  };
  fileWebSocket.on('file:uploaded', handleUploaded);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64.substring(i * chunkSize, Math.min((i + 1) * chunkSize, base64.length));
    fileWebSocket.sendMessage({
      type: 'file:upload',
      payload: {
        path: overlay.path.value,
        content: chunk,
        chunkIndex: i,
        totalChunks,
        totalSize: bytes.length,
        overwrite: true,
      },
      timestamp: Date.now(),
    });
  }
}

function showSuccessToast(msg: string) {
  isErrorToast.value = false;
  toastMessage.value = msg;
  showToast.value = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { showToast.value = false; }, 3000);
}

function showErrorToast(msg: string) {
  isErrorToast.value = true;
  toastMessage.value = msg;
  showToast.value = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { showToast.value = false; }, 3000);
}

defineExpose({ overlay });
</script>

<style scoped>
.file-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg-root);
  display: flex;
  flex-direction: column;
}

.overlay-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.back-btn, .edit-btn, .save-btn, .cancel-edit-btn, .download-btn {
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  cursor: pointer;
  min-height: 44px;
  min-width: 44px;
}

.back-btn { background: transparent; color: var(--text-primary); }
.edit-btn { background: var(--bg-surface-elevated); color: var(--info); border: 1px solid var(--border-default); }
.save-btn { background: var(--success); color: #fff; }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cancel-edit-btn { background: transparent; color: var(--text-secondary); }
.download-btn { background: var(--bg-surface-elevated); color: var(--text-primary); border: 1px solid var(--border-default); }

.file-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions { display: flex; gap: var(--space-2); }

.overlay-content { flex: 1; overflow: hidden; position: relative; }

.loading-spinner {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.text-preview {
  padding: var(--space-4);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  height: 100%;
  margin: 0;
}

.text-editor {
  width: 100%; height: 100%;
  background: var(--bg-root);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: var(--space-4);
  border: none;
  resize: none;
  outline: none;
}

.iframe-viewer { width: 100%; height: 100%; border: none; }

.image-viewer {
  display: flex; align-items: center; justify-content: center;
  height: 100%; padding: var(--space-4);
}
.image-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; }

.overlay-md { height: 100%; overflow: auto; }

.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  padding: var(--space-3) var(--space-6);
  background: rgba(34, 197, 94, 0.9); color: #fff;
  border-radius: var(--radius-lg); font-size: 14px; z-index: 1001;
}
.toast-error { background: rgba(239, 68, 68, 0.9); }

.overlay-slide-enter-active { transition: transform 300ms ease-out; }
.overlay-slide-leave-active { transition: transform 200ms ease-in; }
.overlay-slide-enter-from { transform: translateY(100%); }
.overlay-slide-leave-to { transform: translateY(100%); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

<style>
.file-overlay .md-editor { --md-bk-color: #1E1E1E !important; background: #1E1E1E !important; height: 100% !important; }
.file-overlay .md-editor-content { background: #1E1E1E !important; }
</style>
