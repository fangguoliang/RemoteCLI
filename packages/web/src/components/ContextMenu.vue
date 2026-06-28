<template>
  <Teleport to="body">
    <div v-if="visible" class="context-menu-overlay" @click="close" @contextmenu.prevent="close">
      <div class="context-menu" :style="menuStyle" role="menu">
        <button class="menu-item" @click.stop="handleRename" role="menuitem">Rename</button>
        <button class="menu-item danger" @click.stop="handleDelete" role="menuitem">Delete</button>
        <div class="menu-divider"></div>
        <button class="menu-item" @click.stop="handleDetails" role="menuitem">Details</button>
      </div>
    </div>

    <!-- Rename dialog -->
    <div v-if="showRename" class="modal-overlay" @click.self="showRename = false" @keydown.esc="showRename = false">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>Rename</h3></div>
        <div class="modal-body">
          <input ref="renameInput" v-model="newName" @keyup.enter="confirmRename" @keyup.esc="showRename = false" />
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showRename = false">Cancel</button>
          <button class="btn-save" @click="confirmRename" :disabled="!newName.trim()">Rename</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="showDelete" class="modal-overlay" @click.self="showDelete = false" @keydown.esc="showDelete = false">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>Delete</h3></div>
        <div class="modal-body">
          <p>Delete "{{ entryName }}"? This cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showDelete = false">Cancel</button>
          <button class="btn-danger" @click="confirmDelete">Delete</button>
        </div>
      </div>
    </div>

    <!-- Details dialog -->
    <div v-if="showDetails" class="modal-overlay" @click.self="showDetails = false" @keydown.esc="showDetails = false">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>Details</h3></div>
        <div class="modal-body">
          <div class="detail-row"><span class="label">Name</span><span>{{ entryName }}</span></div>
          <div class="detail-row"><span class="label">Path</span><span class="mono">{{ entryPath }}</span></div>
          <div class="detail-row" v-if="entrySize !== undefined"><span class="label">Size</span><span>{{ formatSize(entrySize) }}</span></div>
          <div class="detail-row" v-if="entryModified"><span class="label">Modified</span><span>{{ formatTime(entryModified) }}</span></div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showDetails = false">Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import type { FileEntry } from '@remotecli/shared';
import { fileWebSocket } from '@/services/fileWebSocket';

const emit = defineEmits<{
  refresh: [];
}>();

const props = defineProps<{
  currentPath: string;
}>();

const visible = ref(false);
const menuStyle = ref({ top: '0px', left: '0px' });
const entryName = ref('');
const entryPath = ref('');
const entrySize = ref<number | undefined>();
const entryModified = ref<number | undefined>();
const entryIsDir = ref(false);

const showRename = ref(false);
const showDelete = ref(false);
const showDetails = ref(false);
const newName = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

function open(x: number, y: number, name: string, entry: FileEntry) {
  entryName.value = name;
  entryPath.value = props.currentPath ? `${props.currentPath}\\${name}` : name;
  entrySize.value = entry.size;
  entryModified.value = entry.modifiedAt;
  entryIsDir.value = entry.isDirectory;

  const menuW = 160, menuH = 140;
  const vw = window.innerWidth, vh = window.innerHeight;
  menuStyle.value = {
    top: `${Math.min(y, vh - menuH)}px`,
    left: `${Math.min(x, vw - menuW)}px`,
  };
  visible.value = true;
}

function close() {
  visible.value = false;
}

function handleRename() {
  close();
  newName.value = entryName.value;
  showRename.value = true;
  nextTick(() => renameInput.value?.focus());
}

function handleDelete() {
  close();
  showDelete.value = true;
}

function handleDetails() {
  close();
  showDetails.value = true;
}

function confirmRename() {
  if (!newName.value.trim()) return;
  fileWebSocket.renameFile(entryPath.value, newName.value.trim());
  showRename.value = false;
  const handler = (data: unknown) => {
    const payload = data as { success: boolean; error?: string };
    if (payload.success) {
      emit('refresh');
    } else {
      alert(payload.error || 'Rename failed');
    }
    fileWebSocket.off('file:rename:result', handler);
  };
  fileWebSocket.on('file:rename:result', handler);
}

function confirmDelete() {
  fileWebSocket.deleteFile(entryPath.value, entryIsDir.value);
  showDelete.value = false;
  const handler = (data: unknown) => {
    const payload = data as { success: boolean; error?: string };
    if (payload.success) {
      emit('refresh');
    } else {
      alert(payload.error || 'Delete failed');
    }
    fileWebSocket.off('file:delete:result', handler);
  };
  fileWebSocket.on('file:delete:result', handler);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

defineExpose({ open });
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
}

.context-menu {
  position: fixed;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  min-width: 140px;
  overflow: hidden;
  z-index: 901;
  animation: menu-in 150ms ease;
}

@keyframes menu-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.menu-item {
  display: block;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  min-height: 44px;
  transition: background var(--transition-fast);
}

.menu-item:hover {
  background: var(--bg-surface-hover);
}

.menu-item.danger {
  color: var(--error);
}

.menu-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-1) 0;
}

/* Modal styles (reuse pattern from FileView) */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-surface-elevated);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-default);
}

.modal-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.modal-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.1rem;
}

.modal-body {
  padding: var(--space-4);
}

.modal-body input {
  width: 100%;
  padding: var(--space-3);
  background: var(--bg-root);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 1rem;
  box-sizing: border-box;
}

.modal-body input:focus {
  outline: none;
  border-color: var(--accent);
}

.modal-body p {
  color: var(--text-secondary);
  margin: 0;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.detail-row .label {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.detail-row .mono {
  font-family: monospace;
  font-size: 0.85rem;
  word-break: break-all;
}

.modal-footer {
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.btn-cancel, .btn-save, .btn-danger {
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  min-height: 44px;
}

.btn-cancel {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.btn-save {
  background: var(--accent);
  color: var(--text-on-accent);
}

.btn-danger {
  background: var(--error);
  color: #fff;
}
</style>
