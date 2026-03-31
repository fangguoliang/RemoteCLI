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

export interface ValidatedPath {
  originalPath: string;
  resolvedPath: string;
  exists: boolean;
}

export const useFileStore = defineStore('file', () => {
  const currentPath = ref<string>('');
  const entries = ref<FileEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const transfers = ref<TransferProgress[]>([]);

  // Markdown viewer state
  const validatingPath = ref<string | null>(null);
  const validatedPath = ref<ValidatedPath | null>(null);
  const viewerVisible = ref(false);
  const viewerContent = ref<string>('');
  const viewerLoading = ref(false);
  const viewerPath = ref<string>('');
  const viewerSaving = ref(false);

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

  // Viewer methods
  function setValidatingPath(path: string | null) {
    validatingPath.value = path;
  }

  function setValidatedPath(result: ValidatedPath | null) {
    validatedPath.value = result;
  }

  function setViewerVisible(visible: boolean) {
    viewerVisible.value = visible;
  }

  function setViewerContent(content: string) {
    viewerContent.value = content;
  }

  function setViewerLoading(loading: boolean) {
    viewerLoading.value = loading;
  }

  function setViewerPath(path: string) {
    viewerPath.value = path;
  }

  function setViewerSaving(saving: boolean) {
    viewerSaving.value = saving;
  }

  function clearViewer() {
    viewerVisible.value = false;
    viewerContent.value = '';
    viewerPath.value = '';
    viewerLoading.value = false;
    viewerSaving.value = false;
    validatedPath.value = null;
    validatingPath.value = null;
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
    // Markdown viewer
    validatingPath,
    validatedPath,
    viewerVisible,
    viewerContent,
    viewerLoading,
    viewerPath,
    viewerSaving,
    setValidatingPath,
    setValidatedPath,
    setViewerVisible,
    setViewerContent,
    setViewerLoading,
    setViewerPath,
    setViewerSaving,
    clearViewer,
  };
});