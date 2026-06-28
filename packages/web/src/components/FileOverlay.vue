<template>
  <Teleport to="body">
    <Transition name="overlay-slide">
      <div v-if="overlay.visible.value" class="file-overlay" :class="{ 'html-fullscreen': isHtmlFullscreen }" role="dialog" aria-modal="true" aria-label="File viewer" @keydown.esc="handleClose">
        <!-- Header (hidden in HTML fullscreen) -->
        <div v-if="!isHtmlFullscreen" class="overlay-header">
          <button class="back-btn" @click="handleClose">&larr;</button>
          <span class="file-name">{{ fileName }}</span>
          <div class="header-actions">
            <button v-if="canEdit && overlay.mode.value === 'view'" class="edit-btn" @click="overlay.setMode('edit')">Edit</button>
            <button v-if="overlay.mode.value === 'edit'" class="cancel-edit-btn" @click="handleCancelEdit">Cancel</button>
            <button v-if="overlay.mode.value === 'edit'" class="save-btn" @click="handleSave" :disabled="overlay.saving.value">
              {{ overlay.saving.value ? 'Saving...' : 'Save' }}
            </button>
            <template v-if="isTextType">
              <button class="zoom-btn" @click="fontSize = Math.max(10, fontSize - 2)" title="Smaller font">A-</button>
              <button class="zoom-btn" @click="fontSize = Math.min(32, fontSize + 2)" title="Larger font">A+</button>
            </template>
            <button class="download-btn" @click="handleDownload">&darr;</button>
          </div>
        </div>

        <!-- Content -->
        <div ref="contentRef" class="overlay-content" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
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
            <pre v-if="overlay.mode.value === 'view'" class="text-preview" :style="{ fontSize: fontSize + 'px' }">{{ overlay.content.value || '(Empty file)' }}</pre>
            <textarea v-else class="text-editor" :style="{ fontSize: fontSize + 'px' }" :value="overlay.content.value" @input="onTextInput" spellcheck="false"></textarea>
          </template>

          <!-- HTML/PDF viewer -->
          <div v-else-if="overlay.fileType.value === 'html' || overlay.fileType.value === 'pdf'" class="iframe-container">
            <!-- Device width toggle for HTML -->
            <div v-if="overlay.fileType.value === 'html'" class="device-toggle" :class="{ vertical: isHtmlFullscreen }">
              <template v-if="isHtmlFullscreen">
                <!-- Vertical sidebar in fullscreen -->
                <button class="close-fs-btn" @click="exitFullscreen" title="Exit fullscreen">✕</button>
                <button :class="{ active: deviceWidth === 'mobile' }" @click="setDevice('mobile')" title="Mobile">📱</button>
                <button :class="{ active: deviceWidth === 'tablet' }" @click="setDevice('tablet')" title="Tablet">📟</button>
                <button :class="{ active: deviceWidth === 'desktop' }" @click="setDevice('desktop')" title="Desktop">🖥️</button>
              </template>
              <template v-else>
                <!-- Horizontal bar in normal mode -->
                <button :class="{ active: deviceWidth === 'mobile' }" @click="setDevice('mobile')" title="Mobile (375px)">📱</button>
                <button :class="{ active: deviceWidth === 'tablet' }" @click="setDevice('tablet')" title="Tablet (768px)">📟</button>
                <button :class="{ active: deviceWidth === 'desktop' }" @click="setDevice('desktop')" title="Desktop (100%)">🖥️</button>
                <button class="fullscreen-btn" @click="enterFullscreen" title="Fullscreen + landscape">⤢</button>
              </template>
            </div>
            <div class="iframe-wrapper" :class="`device-${deviceWidth}`">
              <!-- [pdf-fix] Use PDF.js for universal PDF rendering on mobile -->
              <PdfViewer v-if="overlay.fileType.value === 'pdf' && pdfBlobUrl"
                         :blobUrl="pdfBlobUrl"
                         @download="handleDownload"
                         class="iframe-viewer" />
              <iframe v-else-if="overlay.fileType.value === 'html'"
                      :src="iframeSrc" class="iframe-viewer" @load="onIframeLoad" @error="onIframeError"></iframe>
            </div>
          </div>

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
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { useFileOverlay } from '@/composables/useFileOverlay';
import { fileWebSocket } from '@/services/fileWebSocket';
import { blackbox } from '@/utils/eventLogger';
import PdfViewer from './PdfViewer.vue';

const router = useRouter();
const overlay = useFileOverlay();

// Close overlay when navigating away (e.g., clicking Terminal)
router.afterEach(() => {
  if (overlay.visible.value) {
    if (overlay.dirty.value && overlay.mode.value === 'edit') {
      // Silently discard changes when navigating away
      overlay.dirty.value = false;
    }
    fileWebSocket.cancelViewing();
    overlay.close();
  }
});
const showToast = ref(false);
const toastMessage = ref('');
const isErrorToast = ref(false);
const deviceWidth = ref<'mobile' | 'tablet' | 'desktop'>('mobile');
const isFullscreen = ref(false);
const contentRef = ref<HTMLElement | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

// [pdf-fix] Blob URL for PDF (data URLs for large PDFs show blank on mobile browsers)
const pdfBlobUrl = ref('');

// [swipe-nav-fix] Push a history state when overlay opens to trap browser swipe-back gesture.
// When the user swipes back, popstate fires → we close the overlay instead of navigating away.
let overlayHistoryPushed = false;

function onPopStateCloseOverlay() {
  if (overlayHistoryPushed && overlay.visible.value) {
    overlayHistoryPushed = false;
    handleClose();
    // Signal to FileView's popstate handler that we handled this swipe-back
    (window as any).__swipeBackHandled = true;
    setTimeout(() => { (window as any).__swipeBackHandled = false; }, 100);
  }
}

window.addEventListener('popstate', onPopStateCloseOverlay);

// Push a dummy history state when overlay opens, so swipe-back triggers popstate (→ close overlay)
// instead of actual browser back navigation
watch(() => overlay.visible.value, (visible) => {
  if (visible && !overlayHistoryPushed) {
    history.pushState({ fileOverlay: true }, '');
    overlayHistoryPushed = true;
  }
});

// [pdf-fix] Convert PDF base64 content to blob URL for iframe display.
// Data URLs for large PDFs (>1MB) show blank on mobile browsers.
// Blob URLs are rendered natively by the browser's PDF plugin.
watch(
  () => overlay.content.value,
  (content) => {
    if (overlay.fileType.value !== 'pdf') return;
    // Revoke old blob URL to prevent memory leak
    if (pdfBlobUrl.value) {
      URL.revokeObjectURL(pdfBlobUrl.value);
      pdfBlobUrl.value = '';
    }
    if (!content) return;
    try {
      const binaryString = atob(content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      pdfBlobUrl.value = URL.createObjectURL(blob);
      blackbox.log('pdf', 'pdf:blob-created', { blobSize: blob.size, contentLen: content.length });
    } catch (err) {
      blackbox.log('pdf', 'pdf:blob-error', { error: String(err) });
    }
  }
);

// [pdf-fix] Clean up blob URL when overlay closes or fileType changes away from PDF
watch(
  () => [overlay.visible.value, overlay.fileType.value] as const,
  ([visible, fileType]) => {
    if ((!visible || fileType !== 'pdf') && pdfBlobUrl.value) {
      URL.revokeObjectURL(pdfBlobUrl.value);
      pdfBlobUrl.value = '';
    }
  }
);

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopStateCloseOverlay);
  if (pdfBlobUrl.value) {
    URL.revokeObjectURL(pdfBlobUrl.value);
    pdfBlobUrl.value = '';
  }
});

// HTML fullscreen: hide header, show vertical sidebar
const isHtmlFullscreen = computed(() => isFullscreen.value && overlay.fileType.value === 'html');

// Font size for txt/json (default 17px, up from 13px)
const fontSize = ref(17);
const isTextType = computed(() => overlay.fileType.value === 'txt' || overlay.fileType.value === 'json');

// Non-passive touchmove listener to prevent browser horizontal swipe navigation
let touchStartTarget: HTMLElement | null = null;

function onTouchStartCapture(e: TouchEvent) {
  touchStartTarget = e.target as HTMLElement;
  blackbox.log('overlay-touch', 'fileoverlay:touchstart', {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY,
    targetClass: touchStartTarget?.className?.slice(0, 50) || 'unknown',
    isToolbar: !!touchStartTarget?.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper'),
    isScrollable: !!touchStartTarget?.closest('.text-preview, .text-editor, .overlay-md, .md-editor, .md-editor-preview-wrap'),
  });
}

function onTouchMove(e: TouchEvent) {
  const dx = Math.abs(e.touches[0].clientX - swipeStartX);
  const dy = Math.abs(e.touches[0].clientY - swipeStartY);
  const isHorizontal = dx > dy;

  // For toolbar: still prevent horizontal swipe that would trigger browser navigation
  if (touchStartTarget?.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper')) {
    if (isHorizontal && dx > 10) {
      e.preventDefault();
      blackbox.log('overlay-touch', 'fileoverlay:touchmove-blocked-toolbar', { dx, dy, prevented: true });
    }
    return;
  }
  // Allow scroll on text/md content elements
  if (touchStartTarget?.closest('.text-preview, .text-editor, .overlay-md, .md-editor, .md-editor-preview-wrap')) {
    // [md-fix] Check if content is scrollable horizontally (wide tables, code blocks, etc.)
    const scrollContainer = touchStartTarget?.closest('.overlay-md') as HTMLElement;
    if (scrollContainer && scrollContainer.scrollWidth > scrollContainer.clientWidth) {
      // Content is wider than container - allow horizontal scroll
      return;
    }
    // Content fits or no overflow - prevent horizontal swipe to avoid browser navigation
    if (isHorizontal && dx > 30) {
      e.preventDefault();
      blackbox.log('overlay-touch', 'fileoverlay:touchmove-blocked-content', { dx, dy, prevented: true });
    }
    return;
  }
  // [pdf-fix] Allow horizontal scroll in PDF viewer when zoomed (content wider than container)
  const pdfViewer = touchStartTarget?.closest('.pdf-viewer') as HTMLElement;
  if (pdfViewer) {
    // Check if PDF content is scrollable horizontally (zoomed in)
    if (pdfViewer.scrollWidth > pdfViewer.clientWidth) {
      // Allow horizontal scrolling - don't prevent default
      return;
    }
    // If not zoomed, prevent horizontal swipe to avoid browser navigation
    if (isHorizontal && dx > 10) {
      e.preventDefault();
    }
    return;
  }
  // For all other areas, prevent horizontal swipe
  if (isHorizontal && dx > 10) {
    e.preventDefault();
    blackbox.log('overlay-touch', 'fileoverlay:touchmove-blocked-other', { dx, dy, prevented: true });
  }
}

function onTouchEndCapture(e: TouchEvent) {
  blackbox.log('overlay-touch', 'fileoverlay:touchend', {
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
    // Inject viewport meta for responsive rendering
    let html = overlay.content.value;
    if (!html.includes('viewport')) {
      const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${viewportMeta}`);
      } else if (html.includes('<html>')) {
        html = html.replace('<html>', `<html><head>${viewportMeta}</head>`);
      } else {
        html = viewportMeta + html;
      }
    }
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
  if (overlay.fileType.value === 'pdf') {
    // [pdf-fix] Use blob URL for PDF - data URLs show blank for large PDFs on mobile browsers
    return pdfBlobUrl.value || 'about:blank';
  }
  return '';
});

const imageSrc = computed(() => {
  if (overlay.fileType.value !== 'image') return '';
  const ext = (overlay.path.value.split('.').pop() || '').toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  };
  const mime = mimeMap[ext] || 'image';
  return `data:${mime};base64,${overlay.content.value}`;
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

function onIframeLoad() {
  blackbox.log('pdf', 'iframe:loaded', {
    fileType: overlay.fileType.value,
    src: iframeSrc.value?.substring(0, 60) || '(empty)',
  });
}

function onIframeError() {
  blackbox.log('pdf', 'iframe:error', {
    fileType: overlay.fileType.value,
    src: iframeSrc.value?.substring(0, 60) || '(empty)',
  });
  showErrorToast('Failed to load file in viewer');
}

function handleClose() {
  if (overlay.dirty.value && overlay.mode.value === 'edit') {
    if (!confirm('Discard changes?')) return;
  }
  // Clean up fileWebSocket viewing state to prevent orphaned chunks from triggering downloads
  fileWebSocket.cancelViewing();
  overlay.close();
}

function handleCancelEdit() {
  if (overlay.dirty.value) {
    if (!confirm('Discard changes?')) return;
  }
  overlay.setMode('view');
}

// Swipe gesture: only for switching between edit/preview, with strict thresholds
let swipeStartX = 0;
let swipeStartY = 0;

function handleTouchStart(e: TouchEvent) {
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
}

function handleTouchEnd(e: TouchEvent) {
  if (!canEdit.value) return;
  // Skip swipe if touch started on toolbar
  const target = touchStartTarget || (e.target as HTMLElement);
  if (target.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper')) return;
  // Skip if touch started on text preview/editor (not swipeable)
  if (target.closest('.text-preview, .text-editor')) return;

  const endX = e.changedTouches[0].clientX;
  const endY = e.changedTouches[0].clientY;
  const dx = endX - swipeStartX;
  const dy = Math.abs(endY - swipeStartY);

  // Must be primarily horizontal: horizontal distance > 2x vertical, and > 100px
  if (Math.abs(dx) > 100 && Math.abs(dx) > dy * 2) {
    // [md-fix] For MD content, only switch mode if it's a deliberate swipe
    // (user intentionally swiped from edge or made a very large movement)
    if (target.closest('.overlay-md, .md-editor')) {
      // Check if this looks like an intentional swipe gesture
      // vs just scrolling horizontally through wide content
      const isEdgeSwipe = swipeStartX < 50 || swipeStartX > window.innerWidth - 50;
      const isLargeSwipe = Math.abs(dx) > 150;
      if (!isEdgeSwipe && !isLargeSwipe) {
        // Small swipe in middle of content - likely just scrolling, don't switch mode
        return;
      }
    }

    if (dx < 0 && overlay.mode.value === 'view') {
      overlay.setMode('edit');
    } else if (dx > 0 && overlay.mode.value === 'edit') {
      if (overlay.dirty.value) {
        if (!confirm('Discard changes?')) return;
      }
      overlay.setMode('view');
    }
  }
}

function setDevice(mode: 'mobile' | 'tablet' | 'desktop') {
  deviceWidth.value = mode;
  // Auto-enter fullscreen for tablet/desktop
  if ((mode === 'tablet' || mode === 'desktop') && !isFullscreen.value) {
    enterFullscreen();
  }
}

async function enterFullscreen() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      isFullscreen.value = true;
      // Try landscape orientation on mobile
      if (screen.orientation && 'lock' in screen.orientation) {
        try { await (screen.orientation as any).lock('landscape'); } catch { /* not supported */ }
      }
    }
  } catch { /* fullscreen not supported or denied */ }
}

async function exitFullscreen() {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      isFullscreen.value = false;
      if (screen.orientation && 'unlock' in screen.orientation) {
        try { (screen.orientation as any).unlock(); } catch { /* */ }
      }
    }
  } catch { /* */ }
}

// Track fullscreen state changes — always unlock orientation when exiting
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement;
    if (!document.fullscreenElement) {
      // Unlock orientation when exiting fullscreen (from any source)
      try {
        if (screen.orientation && 'unlock' in screen.orientation) {
          (screen.orientation as any).unlock();
        }
      } catch { /* */ }
      // Reset to mobile width when exiting fullscreen
      deviceWidth.value = 'mobile';
    }
  });
}

function handleDownload() {
  // [pdf-fix] Download directly from existing overlay content (already in memory).
  // This avoids the WebSocket re-download which has a race condition:
  // cancelViewing() clears viewing state, then download() triggers a new request,
  // but file:data handlers can be dropped or timing-mismatched causing silent failure.
  const content = overlay.content.value;
  const filePath = overlay.path.value;
  blackbox.log('pdf', 'pdf:download-clicked', {
    hasContent: !!content,
    contentLen: content?.length ?? 0,
    path: filePath,
    fileType: overlay.fileType.value,
  });
  if (!content || !filePath) return;

  const fileName = filePath.split(/[/\\]/).pop() || 'download';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'html': 'text/html', 'htm': 'text/html',
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'png': 'image/png', 'gif': 'image/gif',
    'webp': 'image/webp', 'svg': 'image/svg+xml', 'bmp': 'image/bmp',
    'txt': 'text/plain', 'json': 'application/json',
    'md': 'text/markdown',
  };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  let blob: Blob;
  const isBinaryExt = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
  if (isBinaryExt) {
    // Decode base64 → binary → Blob
    const binaryString = atob(content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: mimeType });
  } else {
    // Text content: encode as UTF-8
    const bytes = new TextEncoder().encode(content);
    blob = new Blob([bytes], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
      clearTimeout(saveTimeout);
      fileWebSocket.off('file:uploaded', handleUploaded);
    }
  };
  fileWebSocket.on('file:uploaded', handleUploaded);

  // Timeout: if no response in 30s, clean up handler and reset saving state
  const saveTimeout = setTimeout(() => {
    fileWebSocket.off('file:uploaded', handleUploaded);
    overlay.saving.value = false;
    showErrorToast('Save timeout, retry');
  }, 30000);

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
  /* touch-action removed - was 'none' which blocked vertical scrolling via CSS inheritance.
     Horizontal swipe prevention is handled by JS touchmove preventDefault handler. */
}

/* Do NOT set touch-action on content elements - let MdEditor's internal touch-action: none
   block swipe-back at root level, while the browser detects overflow:auto child for vertical scroll.
   overscroll-behavior: none prevents edge glow / overscroll navigation. */
.file-overlay .text-preview,
.file-overlay .text-editor,
.file-overlay .overlay-md,
.file-overlay .md-editor {
  overscroll-behavior: none;
}

/* MD toolbar: allow horizontal scroll, block browser swipe navigation */
.file-overlay :deep(.md-editor-toolbar),
.file-overlay :deep(.md-b-toolbar) {
  touch-action: pan-x;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  flex-wrap: nowrap !important;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.file-overlay :deep(.md-editor-toolbar)::-webkit-scrollbar,
.file-overlay :deep(.md-b-toolbar)::-webkit-scrollbar {
  display: none;
}

/* HTML fullscreen: maximize iframe area */
.file-overlay.html-fullscreen {
  background: #000;
}
.file-overlay.html-fullscreen .iframe-container {
  height: 100vh;
}
.file-overlay.html-fullscreen .iframe-wrapper.device-mobile .iframe-viewer {
  width: 100%;
  max-width: 100%;
  box-shadow: none;
}
.file-overlay.html-fullscreen .iframe-wrapper.device-tablet .iframe-viewer {
  width: 100%;
  max-width: 100%;
  box-shadow: none;
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

.back-btn { background: transparent; color: var(--text-primary); touch-action: manipulation; }
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
  font-size: 17px;
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
  font-size: 17px;
  line-height: 1.6;
  padding: var(--space-4);
  border: none;
  resize: none;
  outline: none;
}

.zoom-btn {
  padding: var(--space-1) var(--space-2);
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  min-height: 36px;
  min-width: 36px;
}

.iframe-viewer { width: 100%; height: 100%; border: none; }

.iframe-container { display: flex; flex-direction: column; height: 100%; }

.device-toggle {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.device-toggle.vertical {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  background: rgba(0, 0, 0, 0.7);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  border: none;
  z-index: 10;
  box-shadow: -2px 0 10px rgba(0,0,0,0.3);
}

.device-toggle .close-fs-btn {
  font-size: 18px;
  color: var(--error);
  min-height: 44px;
  min-width: 44px;
}

.device-toggle button {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  min-height: 36px;
  transition: all var(--transition-fast);
}

.device-toggle button.active {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.device-toggle .fullscreen-btn {
  font-size: 20px;
  font-weight: bold;
  min-width: 44px;
}

.iframe-wrapper {
  flex: 1;
  display: flex;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-root);
}

.iframe-wrapper .iframe-viewer {
  height: 100%;
  transition: width 200ms ease;
}

.iframe-wrapper.device-mobile .iframe-viewer { width: 375px; max-width: 100%; box-shadow: 0 0 20px rgba(0,0,0,0.3); }
.iframe-wrapper.device-tablet .iframe-viewer { width: 768px; max-width: 100%; box-shadow: 0 0 20px rgba(0,0,0,0.3); }
.iframe-wrapper.device-desktop .iframe-viewer { width: 100%; }

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
/* Make toolbar horizontally scrollable on mobile */
.file-overlay .md-editor-toolbar,
.file-overlay .md-b-toolbar {
  overflow-x: auto !important;
  overflow-y: hidden !important;
  flex-wrap: nowrap !important;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.file-overlay .md-editor-toolbar::-webkit-scrollbar,
.file-overlay .md-b-toolbar::-webkit-scrollbar {
  display: none;
}
.file-overlay .md-editor-toolbar-wrap {
  overflow: hidden;
}
</style>
