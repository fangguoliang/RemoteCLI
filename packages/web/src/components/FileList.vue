<template>
  <div class="file-list">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="entries.length === 0" class="empty">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
      <span>此目录为空</span>
    </div>
    <div v-else class="entries">
      <div
        v-for="entry in entries"
        :key="entry.name"
        class="entry"
        :class="{ directory: entry.isDirectory }"
        @click="onEntryClick(entry)"
      >
        <span class="icon">
          <svg v-if="entry.isDirectory" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        </span>
        <span class="name">{{ entry.name }}</span>
        <span v-if="!entry.isDirectory && entry.size" class="size">{{ formatSize(entry.size) }}</span>
        <span v-if="entry.modifiedAt" class="time">{{ formatTime(entry.modifiedAt) }}</span>
      </div>
    </div>  </div>
</template>

<script setup lang="ts">
import type { FileEntry } from '@remotecli/shared';

defineProps<{
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  browse: [path: string];
  download: [path: string];
}>();

function onEntryClick(entry: FileEntry) {
  // 这里需要父组件传入当前路径来拼接
  if (entry.isDirectory) {
    emit('browse', entry.name);
  } else {
    emit('download', entry.name);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MM}-${DD} ${hh}:${mm}`;
}
</script>

<style scoped>
.file-list {
  flex: 1;
  overflow-y: auto;
}

.loading, .error, .empty {
  padding: var(--space-5);
  text-align: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.empty-icon {
  color: var(--text-muted);
  opacity: 0.5;
}

.loading::before {
  content: '';
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--accent-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: var(--space-2);
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error {
  color: var(--error);
}

.entries {
  animation: fade-in var(--duration-base) ease;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.entry {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.entry:hover {
  background: var(--bg-surface-hover);
}

.entry.directory {
  color: var(--info);
}

.icon {
  margin-right: var(--space-3);
  flex-shrink: 0;
  color: inherit;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-left: var(--space-3);
  font-variant-numeric: tabular-nums;
}

.time {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-left: var(--space-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>