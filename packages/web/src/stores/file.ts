import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FileEntry } from '@remotecli/shared';

export interface TransferProgress {
  id: string;
  path: string;
  fileName: string;
  direction: 'upload' | 'download';
  percent: number;
  status: 'in_progress' | 'completed' | 'error';
  error?: string;
}

export const useFileStore = defineStore('file', () => {
  const currentPath = ref<string>('');
  const entries = ref<FileEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const transfers = ref<TransferProgress[]>([]);

  function setPath(path: string) {
    currentPath.value = path;
  }

  function setEntries(list: FileEntry[]) {
    entries.value = list;
  }

  function setLoading(value: boolean) {
    loading.value = value;
  }

  function setError(err: string | null) {
    error.value = err;
  }

  function addTransfer(transfer: TransferProgress) {
    transfers.value.push(transfer);
  }

  function updateTransfer(id: string, updates: Partial<TransferProgress>) {
    const index = transfers.value.findIndex(t => t.id === id);
    if (index !== -1) {
      transfers.value[index] = { ...transfers.value[index], ...updates };
    }
  }

  function removeTransfer(id: string) {
    const index = transfers.value.findIndex(t => t.id === id);
    if (index !== -1) {
      transfers.value.splice(index, 1);
    }
  }

  function clearCompletedTransfers() {
    transfers.value = transfers.value.filter(t => t.status === 'in_progress');
  }

  return {
    currentPath,
    entries,
    loading,
    error,
    transfers,
    setPath,
    setEntries,
    setLoading,
    setError,
    addTransfer,
    updateTransfer,
    removeTransfer,
    clearCompletedTransfers,
  };
});