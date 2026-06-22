import { ref, onUnmounted } from 'vue';

interface UseAudioRecorderOptions {
  onAudioChunk: (chunk: Uint8Array, seq: number) => void;
  onVadStart: () => void;
  onVadEnd: (reason: 'silence' | 'manual') => void;
  silenceThresholdMs?: number;
  energyThreshold?: number;
}

export function useAudioRecorder(options: UseAudioRecorderOptions) {
  const isRecording = ref(false);
  const isSupported = ref(!!navigator.mediaDevices?.getUserMedia);
  const error = ref<string | null>(null);

  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let seq = 0;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let isSpeaking = false;

  const SILENCE_MS = options.silenceThresholdMs || 800;
  const ENERGY_THRESHOLD = options.energyThreshold || 0.01;

  async function start() {
    if (!isSupported.value) {
      error.value = '浏览器不支持麦克风';
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1
        }
      });
      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(mediaStream);

      // Use ScriptProcessorNode for PCM access (simpler than AudioWorklet)
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const energy = computeEnergy(inputData);

        if (energy > ENERGY_THRESHOLD) {
          // Speaking
          if (!isSpeaking) {
            isSpeaking = true;
            options.onVadStart();
          }
          resetSilenceTimer();

          // Convert float32 to 16-bit PCM
          const pcm = float32ToPCM16(inputData);
          options.onAudioChunk(pcm, seq++);
        } else {
          // Silence
          resetSilenceTimer();
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      isRecording.value = true;
      error.value = null;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        error.value = '麦克风权限被拒绝';
      } else {
        error.value = `麦克风错误: ${err.message}`;
      }
    }
  }

  function stop() {
    if (silenceTimer) clearTimeout(silenceTimer);
    processor?.disconnect();
    mediaStream?.getTracks().forEach(t => t.stop());
    audioContext?.close();
    processor = null;
    mediaStream = null;
    audioContext = null;
    isRecording.value = false;
    isSpeaking = false;
    seq = 0;
  }

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isSpeaking) {
        isSpeaking = false;
        options.onVadEnd('silence');
      }
    }, SILENCE_MS);
  }

  function forceVadEnd() {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (isSpeaking) {
      isSpeaking = false;
      options.onVadEnd('manual');
    }
  }

  function computeEnergy(buffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  function float32ToPCM16(float32: Float32Array): Uint8Array {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return new Uint8Array(pcm16.buffer);
  }

  onUnmounted(() => stop());

  return { isRecording, isSupported, error, start, stop, forceVadEnd };
}
