<template>
  <div class="file-list">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="entries.length === 0" class="empty">目录为空</div>
    <div v-else class="entries">
      <div
        v-for="entry in entries"
        :key="entry.name"
        class="entry"
        :class="{ directory: entry.isDirectory }"
        @click="onEntryClick(entry)"
      >
        <span class="icon">{{ entry.isDirectory ? '📁' : '📄' }}</span>
        <span class="name">{{ entry.name }}</span>
        <span v-if="!entry.isDirectory && entry.size" class="size">{{ formatSize(entry.size) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileEntry } from '@ccremote/shared';

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
</script>

<style scoped>
.file-list {
  flex: 1;
  overflow-y: auto;
}

.loading, .error, .empty {
  padding: 20px;
  text-align: center;
  color: #888;
}

.error {
  color: #f44336;
}

.entry {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #333;
  cursor: pointer;
}

.entry:hover {
  background: #2a2a3e;
}

.entry.directory {
  color: #4fc3f7;
}

.icon {
  margin-right: 12px;
  font-size: 18px;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  color: #888;
  font-size: 12px;
  margin-left: 12px;
}
</style>