import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type VoiceBarState = 'idle' | 'recording' | 'result' | 'error';

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
  const mode = ref<VoiceMode>('command');  // 默认执行模式
  const interimText = ref<string>('');
  const inputBuffer = ref<string>('');
  const errorText = ref<string>('');
  const isTtsPlaying = ref<boolean>(false);
  const pendingConfirm = ref<PendingConfirmAction | null>(null);
  const lastRecognizedText = ref<string>('');

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

  function setRecording(recording: boolean) {
    if (recording) {
      barState.value = 'recording';
    } else {
      // 录音结束 -> 进入 result 状态（面板保持展开）
      barState.value = 'result';
    }
  }

  function toggleExpand() {
    if (barState.value === 'idle') {
      // 从 idle 打开 -> 显示上次结果
      if (lastRecognizedText.value) {
        barState.value = 'result';
      } else {
        barState.value = 'recording';
      }
    } else {
      // 任何状态 -> 收起
      barState.value = 'idle';
    }
  }

  function setInterimText(text: string) {
    interimText.value = text;
  }

  function setLastRecognizedText(text: string) {
    if (text && text.trim()) {
      lastRecognizedText.value = text.trim();
    }
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
    lastRecognizedText,
    // Computed
    isRecording,
    isExpanded,
    displayText,
    // Actions
    toggleSession,
    setRecording,
    toggleExpand,
    setInterimText,
    setLastRecognizedText,
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
