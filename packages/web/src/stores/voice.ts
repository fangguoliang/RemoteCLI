import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type VoiceBarState = 'idle' | 'recording' | 'processing' | 'error';

export type VoiceMode = 'input' | 'command';

export interface PendingConfirmAction {
  action: string;
  description: string;
  resolve: (value: boolean) => void;
}

export const useVoiceStore = defineStore('voice', () => {
  // State
  const enabled = ref<boolean>(false);
  const barState = ref<VoiceBarState>('idle');
  const mode = ref<VoiceMode>('input');
  const interimText = ref<string>('');
  const inputBuffer = ref<string>('');
  const errorText = ref<string>('');
  const isTtsPlaying = ref<boolean>(false);
  const pendingConfirm = ref<PendingConfirmAction | null>(null);

  // Computed
  const isRecording = computed(() => barState.value === 'recording');

  const isExpanded = computed(() => barState.value !== 'idle');

  const displayText = computed(() => {
    if (interimText.value) {
      return interimText.value;
    }
    return inputBuffer.value;
  });

  // Actions
  function toggleSession() {
    enabled.value = !enabled.value;
    if (!enabled.value) {
      // If disabling, reset state
      barState.value = 'idle';
      interimText.value = '';
      inputBuffer.value = '';
      errorText.value = '';
      isTtsPlaying.value = false;
      pendingConfirm.value = null;
    }
  }

  function toggleExpand() {
    if (barState.value === 'idle') {
      barState.value = 'recording';
    } else if (barState.value === 'recording') {
      barState.value = 'idle';
    }
  }

  function setInterimText(text: string) {
    interimText.value = text;
  }

  function appendToInputBuffer(text: string) {
    inputBuffer.value += text;
  }

  function clearInputBuffer() {
    inputBuffer.value = '';
  }

  function switchToInputMode() {
    mode.value = 'input';
  }

  function switchToCommandMode() {
    mode.value = 'command';
  }

  function setError(text: string) {
    errorText.value = text;
    barState.value = 'error';
  }

  function clearError() {
    errorText.value = '';
    if (barState.value === 'error') {
      barState.value = 'idle';
    }
  }

  function requestConfirm(action: string, description: string): Promise<boolean> {
    return new Promise((resolve) => {
      pendingConfirm.value = {
        action,
        description,
        resolve,
      };
    });
  }

  function clearConfirm() {
    pendingConfirm.value = null;
  }

  return {
    // State
    enabled,
    barState,
    mode,
    interimText,
    inputBuffer,
    errorText,
    isTtsPlaying,
    pendingConfirm,
    // Computed
    isRecording,
    isExpanded,
    displayText,
    // Actions
    toggleSession,
    toggleExpand,
    setInterimText,
    appendToInputBuffer,
    clearInputBuffer,
    switchToInputMode,
    switchToCommandMode,
    setError,
    clearError,
    requestConfirm,
    clearConfirm,
  };
});
