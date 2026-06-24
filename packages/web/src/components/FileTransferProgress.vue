<template>
  <div v-if="transfers.length > 0" class="transfer-progress">
    <div v-for="transfer in transfers" :key="transfer.id" class="transfer-item">
      <div class="transfer-header">
        <span class="icon">
          <svg v-if="transfer.direction === 'upload'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        </span>
        <span class="filename">{{ transfer.fileName }}</span>
        <span class="percent">{{ transfer.percent }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${transfer.percent}%` }"></div>
      </div>
      <div v-if="transfer.status === 'error'" class="error">{{ transfer.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TransferProgress } from '@/stores/file';

defineProps<{
  transfers: TransferProgress[];
}>();
</script>

<style scoped>
.transfer-progress {
  position: absolute;
  bottom: 90px;
  left: 10px;
  right: 10px;
  z-index: 100;
  max-height: 150px;
  overflow-y: auto;
}

.transfer-item {
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  margin-bottom: var(--space-2);
  box-shadow: var(--shadow-md);
}

.transfer-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-2);
}

.icon {
  margin-right: var(--space-2);
  color: var(--info);
}

.filename {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.percent {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: var(--space-2);
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  height: 4px;
  background: var(--bg-root);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--info), var(--info-light));
  transition: width var(--transition-slow);
}

.error {
  color: var(--error);
  font-size: 12px;
  margin-top: var(--space-2);
}
</style>