<template>
  <div class="pdf-container">
    <!-- Zoom controls -->
    <div class="pdf-toolbar">
      <button @click="zoomOut" :disabled="zoomLevel <= 0.5">−</button>
      <span class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</span>
      <button @click="zoomIn" :disabled="zoomLevel >= 3">+</button>
      <button @click="zoomReset" class="reset-btn">↺</button>
    </div>
    <!-- PDF pages -->
    <div ref="containerRef" class="pdf-viewer" @scroll="onScroll" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
      <div v-if="loading" class="pdf-loading">
        <div class="spinner"></div>
        <span>加载 PDF 中...</span>
      </div>
      <div v-if="error" class="pdf-error">
        <p>{{ error }}</p>
        <button @click="$emit('download')">下载 PDF</button>
      </div>
      <div v-for="page in pages" :key="page.pageNumber" class="pdf-page-wrapper">
        <canvas :ref="el => setCanvasRef(el as HTMLCanvasElement, page.pageNumber)"></canvas>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';
import { blackbox } from '@/utils/eventLogger';

// [pdf-fix] Configure PDF.js worker for v3.x
const workerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = `${workerUrl}${workerUrl.includes('?') ? '&' : '?'}_v=${Date.now()}`;

blackbox.log('pdf', 'pdf:js-init', {
  version: pdfjsLib.version,
  workerSrc: pdfjsLib.GlobalWorkerOptions.workerSrc?.substring(0, 80) || '(empty)',
  userAgent: navigator.userAgent.substring(0, 100),
});

const props = defineProps<{
  blobUrl: string;
}>();

defineEmits<{
  download: [];
}>();

const containerRef = ref<HTMLElement | null>(null);
const loading = ref(true);
const error = ref('');
const pages = ref<{ pageNumber: number }[]>([]);
const canvasRefs = new Map<number, HTMLCanvasElement>();
const zoomLevel = ref(1); // 1 = fit width, 0.5 = 50%, 2 = 200%

let pdfDoc: any = null;
const renderTasks = new Map<number, any>();
let baseScale = 1; // Scale to fit width

// Pinch-to-zoom state
let pinchStartDistance = 0;
let pinchStartZoom = 1;

function setCanvasRef(el: HTMLCanvasElement | null, pageNumber: number) {
  if (el) {
    canvasRefs.set(pageNumber, el);
  } else {
    canvasRefs.delete(pageNumber);
  }
}

function zoomIn() {
  zoomLevel.value = Math.min(3, zoomLevel.value + 0.25);
  rerenderAllPages();
}

function zoomOut() {
  zoomLevel.value = Math.max(0.5, zoomLevel.value - 0.25);
  rerenderAllPages();
}

function zoomReset() {
  zoomLevel.value = 1;
  rerenderAllPages();
}

async function rerenderAllPages() {
  if (!pdfDoc) return;
  // Cancel ongoing renders
  renderTasks.forEach(task => {
    try { task.cancel(); } catch { /* ignore */ }
  });
  renderTasks.clear();
  // Re-render visible pages
  const maxPages = Math.min(pdfDoc.numPages, 10);
  for (let i = 1; i <= maxPages; i++) {
    await renderPage(i);
  }
  blackbox.log('pdf', 'pdf:zoom-changed', { zoomLevel: zoomLevel.value });
}

// Pinch-to-zoom handlers
function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    pinchStartDistance = getTouchDistance(e.touches);
    pinchStartZoom = zoomLevel.value;
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const currentDistance = getTouchDistance(e.touches);
    const scale = currentDistance / pinchStartDistance;
    zoomLevel.value = Math.max(0.5, Math.min(3, pinchStartZoom * scale));
  }
}

function onTouchEnd(e: TouchEvent) {
  if (pinchStartDistance > 0 && e.touches.length < 2) {
    pinchStartDistance = 0;
    // Re-render at new zoom level
    rerenderAllPages();
  }
}

function getTouchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

async function loadPdf() {
  loading.value = true;
  error.value = '';

  if (!props.blobUrl) {
    loading.value = false;
    blackbox.log('pdf', 'pdf:no-blob-url', {});
    return;
  }

  blackbox.log('pdf', 'pdf:load-start', { blobUrl: props.blobUrl.substring(0, 50) });

  try {
    // Fetch the PDF blob
    const response = await fetch(props.blobUrl);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    blackbox.log('pdf', 'pdf:js-loaded', { size: arrayBuffer.byteLength });

    // Test worker fetch manually
    try {
      const workerResponse = await fetch(pdfjsLib.GlobalWorkerOptions.workerSrc);
      blackbox.log('pdf', 'pdf:worker-fetch-test', {
        url: pdfjsLib.GlobalWorkerOptions.workerSrc?.substring(0, 80),
        status: workerResponse.status,
        ok: workerResponse.ok,
        contentType: workerResponse.headers.get('content-type'),
      });
    } catch (fetchErr) {
      blackbox.log('pdf', 'pdf:worker-fetch-error', { error: String(fetchErr) });
    }

    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
    });

    blackbox.log('pdf', 'pdf:getDocument-called', {
      hasData: !!arrayBuffer,
      dataSize: arrayBuffer.byteLength,
    });

    pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    blackbox.log('pdf', 'pdf:js-doc-loaded', { numPages });

    // Calculate base scale to fit width
    const viewportWidth = containerRef.value?.clientWidth || window.innerWidth;
    const firstPage = await pdfDoc.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    baseScale = (viewportWidth - 32) / firstViewport.width;

    // Create page entries
    pages.value = Array.from({ length: numPages }, (_, i) => ({
      pageNumber: i + 1,
    }));

    loading.value = false;

    // Wait for DOM to update with canvases
    await nextTick();

    // Render all pages (for mobile, limit initial render)
    const maxInitialPages = Math.min(numPages, 10);
    for (let i = 1; i <= maxInitialPages; i++) {
      await renderPage(i);
    }
  } catch (err) {
    console.error('PDF load error:', err);
    error.value = `PDF 加载失败: ${err instanceof Error ? err.message : String(err)}`;
    loading.value = false;
    blackbox.log('pdf', 'pdf:js-error', {
      error: String(err),
      errorName: err instanceof Error ? err.name : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack?.substring(0, 200) : undefined,
    });
  }
}

async function renderPage(pageNumber: number) {
  if (!pdfDoc || renderTasks.has(pageNumber)) return;

  const canvas = canvasRefs.get(pageNumber);
  if (!canvas) return;

  try {
    const page = await pdfDoc.getPage(pageNumber);
    const context = canvas.getContext('2d');
    if (!context) return;

    // Calculate scale with zoom level
    const scale = baseScale * zoomLevel.value;
    const viewport = page.getViewport({ scale });

    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    // Scale context for high-DPI displays
    context.scale(dpr, dpr);

    // Render the page
    const renderTask = page.render({
      canvasContext: context,
      viewport,
    });
    renderTasks.set(pageNumber, renderTask);

    await renderTask.promise;
    renderTasks.delete(pageNumber);

    blackbox.log('pdf', 'pdf:js-page-rendered', { pageNumber, scale, zoomLevel: zoomLevel.value });
  } catch (err) {
    console.error(`Page ${pageNumber} render error:`, err);
    renderTasks.delete(pageNumber);
  }
}

function onScroll() {
  // Could implement lazy loading for large PDFs here
}

// Watch for blob URL changes
watch(() => props.blobUrl, () => {
  // Cleanup previous PDF
  if (pdfDoc) {
    pdfDoc.destroy();
    pdfDoc = null;
  }
  pages.value = [];
  canvasRefs.clear();
  renderTasks.clear();
  loadPdf();
});

onMounted(() => {
  if (props.blobUrl) {
    loadPdf();
  }
});

onBeforeUnmount(() => {
  // Cleanup
  renderTasks.forEach(task => {
    try { task.cancel(); } catch { /* ignore */ }
  });
  renderTasks.clear();
  if (pdfDoc) {
    pdfDoc.destroy();
    pdfDoc = null;
  }
});
</script>

<style scoped>
.pdf-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px;
  background: #3a3a3a;
  border-bottom: 1px solid #555;
  flex-shrink: 0;
}

.pdf-toolbar button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background: #555;
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pdf-toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pdf-toolbar button:active:not(:disabled) {
  background: #666;
}

.pdf-toolbar .reset-btn {
  font-size: 16px;
}

.pdf-toolbar .zoom-level {
  color: white;
  font-size: 14px;
  min-width: 50px;
  text-align: center;
}

.pdf-viewer {
  flex: 1;
  overflow: auto; /* Allow both horizontal and vertical scroll */
  -webkit-overflow-scrolling: touch;
  background: #525659;
  padding: 16px;
  touch-action: pan-x pan-y; /* Allow both directions, pinch handled separately */
}

.pdf-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: white;
  gap: 16px;
}

.pdf-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: white;
  gap: 16px;
}

.pdf-error button {
  padding: 10px 20px;
  background: var(--accent, #409eff);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.pdf-page-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
}

.pdf-page-wrapper canvas {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
