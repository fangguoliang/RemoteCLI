import { ref } from 'vue';
import type { OverlayFileType } from '@/utils/fileType';

export function useFileOverlay() {
  const visible = ref(false);
  const mode = ref<'view' | 'edit'>('view');
  const path = ref('');
  const content = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const fileType = ref<OverlayFileType>('txt');
  const dirty = ref(false);

  function open(filePath: string, type: OverlayFileType, fileContent: string) {
    path.value = filePath;
    fileType.value = type;
    content.value = fileContent;
    mode.value = 'view';
    dirty.value = false;
    loading.value = false;
    saving.value = false;
    visible.value = true;
  }

  function openForEdit(filePath: string, type: OverlayFileType, fileContent: string) {
    open(filePath, type, fileContent);
    mode.value = 'edit';
  }

  function close() {
    visible.value = false;
    content.value = '';
    path.value = '';
    dirty.value = false;
  }

  function updateContent(newContent: string) {
    content.value = newContent;
    dirty.value = true;
  }

  function setMode(newMode: 'view' | 'edit') {
    mode.value = newMode;
  }

  return {
    visible, mode, path, content, loading, saving, fileType, dirty,
    open, openForEdit, close, updateContent, setMode,
  };
}
