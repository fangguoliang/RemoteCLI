<template>
  <div class="voice-container">
    <!-- 危险操作确认对话框 -->
    <div v-if="voiceStore.pendingConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <div class="confirm-title">确认操作</div>
        <div class="confirm-text">{{ voiceStore.pendingConfirm.description }}</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="handleConfirmCancel">取消</button>
          <button class="confirm-btn confirm" @click="handleConfirmExecute">确认执行</button>
        </div>
      </div>
    </div>

    <!-- 展开面板 -->
    <Transition name="panel">
      <div v-if="voiceStore.isExpanded" class="voice-bar-full">
        <div class="voice-bar-header">
          <div class="header-left">
            <MicIcon :active="voiceStore.isRecording" />
            <span class="voice-bar-title">语音助手</span>
            <!-- 模式切换 - 分段控件 -->
            <div class="mode-toggle-container">
              <button
                class="mode-toggle-btn"
                :class="{ active: voiceStore.mode === 'command' }"
                @click="voiceStore.mode !== 'command' && toggleMode()"
              >
                🎯 执行
              </button>
              <button
                class="mode-toggle-btn"
                :class="{ active: voiceStore.mode === 'input' }"
                @click="voiceStore.mode !== 'input' && toggleMode()"
              >
                ⌨️ 输入
              </button>
            </div>
          </div>
          <button class="close-btn" @click="voiceStore.toggleExpand" title="收起">
            <CloseIcon />
          </button>
        </div>

        <!-- 录音状态显示 -->
        <div v-if="voiceStore.isRecording" class="voice-bar-content">
          <div class="voice-text">
            {{ voiceStore.displayText }}
            <span class="cursor">▌</span>
          </div>
          <div class="voice-status">{{ statusText }}</div>
        </div>

        <!-- 结果状态 - 录音结束后显示识别的文字 -->
        <div v-else-if="(voiceStore.lastRecognizedText || voiceStore.displayText) && !voiceStore.errorText" class="voice-bar-content result">
          <div class="last-text">
            <div class="last-text-label">识别结果:</div>
            <div class="last-text-content">{{ voiceStore.displayText || voiceStore.lastRecognizedText }}</div>
          </div>
        </div>

        <!-- 空闲状态 -->
        <div v-else-if="!voiceStore.errorText" class="voice-bar-content idle">
          <div class="idle-hint">点击右下角按钮开始录音</div>
        </div>

        <!-- 错误状态 -->
        <div v-if="voiceStore.errorText" class="voice-error">
          <ErrorIcon />
          <span class="error-text">{{ voiceStore.errorText }}</span>
          <button class="error-close-btn" @click="voiceStore.clearError" title="关闭">×</button>
        </div>

        <!-- 输入模式控制按钮 -->
        <div v-if="voiceStore.mode === 'input' && voiceStore.inputBuffer" class="voice-bar-actions">
          <button class="voice-btn cancel" @click="handleCancel">取消</button>
          <button class="voice-btn send" @click="handleSend">
            <SendIcon />
            <span>发送</span>
          </button>
        </div>
      </div>
    </Transition>

    <!-- 右下角悬浮按钮 (Mini 状态) -->
    <div
      class="voice-bar-mini"
      :class="{ recording: voiceStore.isRecording, error: voiceStore.errorText }"
      @click="handleMicClick"
      v-longpress="handleLongPress"
      role="button"
      :aria-label="voiceStore.isRecording ? '停止录音' : '开始录音'"
    >
      <div class="pulse-ring" v-if="voiceStore.isRecording"></div>
      <MicIcon :active="voiceStore.isRecording" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useVoiceStore } from '../stores/voice';
import { useAudioRecorder } from '../composables/useAudioRecorder';
import { useAudioPlayer } from '../composables/useAudioPlayer';
import {
  sendVoiceStart, sendVoiceAudio, sendVoiceVadState,
  sendVoiceEnd, sendVoiceSend, isVoiceWebSocketReady,
} from '../services/voiceWebSocket';
import { vLongpress } from '../directives/longpress';
import MicIcon from './icons/MicIcon.vue';
import CloseIcon from './icons/CloseIcon.vue';
import SendIcon from './icons/SendIcon.vue';
import ErrorIcon from './icons/ErrorIcon.vue';

const voiceStore = useVoiceStore();
const audioPlayer = useAudioPlayer();

const {
  isRecording: isMicRecording,
  start: startRecording,
  stop: stopRecording,
  forceVadEnd,
  error: recorderError
} = useAudioRecorder({
  onAudioChunk: (chunk, seq) => sendVoiceAudio(chunk, seq),
  onVadStart: () => {
    voiceStore.setRecording(true);
  },
  onVadEnd: (reason) => {
    voiceStore.setRecording(false);
    sendVoiceVadState(false, reason);
    if (voiceStore.mode === 'command') {
      stopRecording();
      sendVoiceEnd();
    }
  },
  silenceThresholdMs: 800,
});

// Watch for recorder errors
if (recorderError.value) {
  voiceStore.setError(recorderError.value);
}

const statusText = computed(() => {
  if (voiceStore.mode === 'input') return '⌨️ 输入模式 - 语音直接输入到终端';
  return '🎯 执行模式 - 语音识别并执行命令';
});

function handleMicClick() {
  if (isMicRecording.value) {
    // Stop recording
    forceVadEnd();
    stopRecording();
    sendVoiceEnd();
    voiceStore.setRecording(false);
    audioPlayer.clear();
    // 不自动收起面板，让用户手动关闭
  } else {
    // Check WebSocket before recording
    if (!isVoiceWebSocketReady()) {
      voiceStore.setError('请先打开一个终端会话');
      if (!voiceStore.isExpanded) {
        voiceStore.toggleExpand();
      }
      return;
    }
    // Start recording
    startRecording().then(() => {
      if (!recorderError.value) {
        voiceStore.setRecording(true);
        sendVoiceStart(16000);
        // 开始录音时自动展开面板
        if (!voiceStore.isExpanded) {
          voiceStore.toggleExpand();
        }
      } else {
        voiceStore.setError(recorderError.value);
        // 有错误时自动展开面板显示错误
        if (!voiceStore.isExpanded) {
          voiceStore.toggleExpand();
        }
      }
    });
  }
}

function handleLongPress() {
  // 长按切换面板展开状态
  voiceStore.toggleExpand();
}

function handleSend() {
  sendVoiceSend();
  voiceStore.switchToCommandMode();
}

function handleCancel() {
  voiceStore.clearInputBuffer();
  voiceStore.switchToCommandMode();
}

function toggleMode() {
  if (voiceStore.mode === 'input') {
    voiceStore.switchToCommandMode();
  } else {
    voiceStore.switchToInputMode();
  }
  // 通知服务器切换模式
  import('../services/voiceWebSocket').then(({ sendVoiceModeChange }) => {
    sendVoiceModeChange(voiceStore.mode);
  });
}

function handleConfirmCancel() {
  if (voiceStore.pendingConfirm) {
    voiceStore.pendingConfirm.resolve(false);
    voiceStore.clearConfirm();
  }
}

function handleConfirmExecute() {
  if (voiceStore.pendingConfirm) {
    voiceStore.pendingConfirm.resolve(true);
    voiceStore.clearConfirm();
  }
}
</script>

<style scoped>
.voice-container {
  position: fixed;
  bottom: calc(60px + var(--space-4, 16px)); /* 上移避免遮挡底部菜单 */
  right: var(--space-4, 16px);
  z-index: 9999;
  font-family: inherit;
  pointer-events: none; /* 让容器不阻挡点击 */
}

.voice-container > * {
  pointer-events: auto; /* 子元素恢复点击 */
}

/* Mini 悬浮按钮 */
.voice-bar-mini {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg-surface-elevated, rgba(30, 30, 30, 0.9));
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  border: 2px solid var(--border-default, rgba(255, 255, 255, 0.1));
  transition: all 0.2s ease;
  position: relative;
}

.voice-bar-mini:hover {
  background: var(--bg-surface-hover, rgba(40, 40, 40, 0.95));
  border-color: var(--accent, #e94560);
  transform: scale(1.05);
}

.voice-bar-mini:active {
  transform: scale(0.95);
}

.voice-bar-mini.recording {
  background: var(--accent, #e94560);
  border-color: var(--accent, #e94560);
  animation: pulse-recording 2s ease-in-out infinite;
}

.voice-bar-mini.error {
  border-color: var(--error, #f44336);
}

@keyframes pulse-recording {
  0%, 100% {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 0 rgba(233, 69, 96, 0.4);
  }
  50% {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 12px rgba(233, 69, 96, 0);
  }
}

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--accent, #e94560);
  animation: pulse-ring 1.5s ease-out infinite;
  pointer-events: none;
}

@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

/* 展开面板 */
.voice-bar-full {
  position: absolute;
  bottom: 64px;
  right: 0;
  width: min(360px, calc(100vw - 32px));
  background: var(--bg-surface-elevated, rgba(30, 30, 30, 0.95));
  backdrop-filter: blur(16px);
  border-radius: 16px;
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.voice-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-surface, rgba(20, 20, 20, 0.9));
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.voice-bar-title {
  color: var(--text-primary, #fff);
  font-size: 1rem;
  font-weight: 600;
}

/* 模式切换 - 分段控件（拟物风格） */
.mode-toggle-container {
  display: flex;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.2) 100%);
  border-radius: 10px;
  padding: 3px;
  margin-left: 6px;
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.5),
    0 1px 0 rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.3);
}

.mode-toggle-btn {
  padding: 5px 14px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  line-height: 1.2;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
}

.mode-toggle-btn:hover:not(.active) {
  color: rgba(255, 255, 255, 0.6);
}

/* 选中的按钮 - 凸起效果 */
.mode-toggle-btn.active {
  background: linear-gradient(180deg, rgba(80, 80, 80, 0.9) 0%, rgba(55, 55, 55, 0.95) 100%);
  color: #ffffff;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.4),
    0 1px 2px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(0, 0, 0, 0.3);
  transform: translateY(-0.5px);
}

/* 按下效果 */
.mode-toggle-btn:active:not(.active) {
  transform: translateY(0.5px);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--bg-surface-hover, rgba(40, 40, 40, 0.95));
  color: var(--text-primary, #fff);
}

.voice-bar-content {
  padding: 16px;
  min-height: 80px;
}

.voice-bar-content.idle {
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-bar-content.result {
  display: flex;
  align-items: flex-start;
}

.idle-hint {
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  font-size: 0.875rem;
}

.last-text {
  width: 100%;
}

.last-text-label {
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  font-size: 0.75rem;
  margin-bottom: 4px;
}

.last-text-content {
  color: var(--text-primary, #fff);
  font-size: 1rem;
  line-height: 1.5;
}

.voice-text {
  color: var(--text-primary, #fff);
  font-size: 1rem;
  line-height: 1.6;
  min-height: 1.6em;
}

.cursor {
  color: var(--accent, #e94560);
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.voice-status {
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 0.875rem;
  margin-top: 4px;
}

.voice-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(244, 67, 54, 0.1);
  border-top: 1px solid rgba(244, 67, 54, 0.2);
  color: var(--error, #f44336);
  font-size: 0.875rem;
}

.error-text {
  flex: 1;
}

.error-close-btn {
  background: transparent;
  border: none;
  color: var(--error, #f44336);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.error-close-btn:hover {
  background: rgba(244, 67, 54, 0.2);
}

.voice-bar-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-surface, rgba(20, 20, 20, 0.9));
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
}

.voice-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
  background: var(--bg-surface-hover, rgba(40, 40, 40, 0.95));
  color: var(--text-primary, #fff);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.voice-btn:hover {
  background: var(--bg-surface-elevated, rgba(50, 50, 50, 0.95));
  border-color: var(--accent, #e94560);
}

.voice-btn:active {
  transform: scale(0.98);
}

.voice-btn.send {
  background: var(--accent, #e94560);
  border-color: var(--accent, #e94560);
  color: #fff;
}

.voice-btn.send:hover {
  background: var(--accent-hover, #d63851);
}

/* 确认对话框 */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.confirm-dialog {
  background: var(--bg-surface-elevated, rgba(30, 30, 30, 0.95));
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
  border-radius: 16px;
  padding: 24px;
  max-width: 400px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.confirm-title {
  color: var(--text-primary, #fff);
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 12px;
}

.confirm-text {
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 20px;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.confirm-btn {
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.confirm-btn.cancel {
  background: var(--bg-surface-hover, rgba(40, 40, 40, 0.95));
  color: var(--text-primary, #fff);
}

.confirm-btn.cancel:hover {
  background: var(--bg-surface-elevated, rgba(50, 50, 50, 0.95));
}

.confirm-btn.confirm {
  background: var(--accent, #e94560);
  border-color: var(--accent, #e94560);
  color: #fff;
}

.confirm-btn.confirm:hover {
  background: var(--accent-hover, #d63851);
}

/* 面板展开/收起动画 */
.panel-enter-active,
.panel-leave-active {
  transition: all 0.2s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.95);
}
</style>
