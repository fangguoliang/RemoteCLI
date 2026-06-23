import { ref, shallowRef } from 'vue';

/**
 * Audio queue item for TTS playback
 */
interface AudioQueueItem {
  id: string;
  audioData: ArrayBuffer;
}

/**
 * Options for the audio player composable
 */
interface UseAudioPlayerOptions {
  /** Callback when playback starts */
  onPlayStart?: () => void;
  /** Callback when playback ends */
  onPlayEnd?: () => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

// AudioContext constructor (browser compatibility)
const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const isPlaying = ref(false);
  const isSupported = ref(!!AudioContextCtor);
  const currentAudioId = ref<string | null>(null);
  const error = ref<string | null>(null);

  // Audio queue management
  const queue = shallowRef<AudioQueueItem[]>([]);
  let audioContext: AudioContext | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;

  /**
   * Initialize or resume AudioContext
   */
  function getAudioContext(): AudioContext | null {
    if (!audioContext) {
      if (!AudioContextCtor) {
        error.value = '浏览器不支持音频播放';
        options.onError?.(error.value);
        return null;
      }
      try {
        audioContext = new AudioContextCtor();
      } catch (e) {
        error.value = '无法初始化音频上下文';
        options.onError?.(error.value);
        return null;
      }
    }

    // Resume if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {
        error.value = '音频播放被浏览器阻止，请点击页面后重试';
        options.onError?.(error.value);
      });
    }

    return audioContext;
  }

  /**
   * Decode base64 audio data to ArrayBuffer
   */
  function decodeBase64Audio(base64Data: string): ArrayBuffer {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Add audio data to the playback queue
   * Supports both ArrayBuffer and base64 string formats
   */
  function enqueue(audioData: ArrayBuffer | string, id?: string): string {
    const audioId = id || `audio-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    let buffer: ArrayBuffer;
    if (typeof audioData === 'string') {
      // Base64 decoding
      try {
        buffer = decodeBase64Audio(audioData);
      } catch (e) {
        error.value = '音频数据解码失败';
        options.onError?.(error.value);
        return audioId;
      }
    } else {
      buffer = audioData;
    }

    queue.value = [...queue.value, { id: audioId, audioData: buffer }];

    // If not currently playing, start playback
    if (!isPlaying.value) {
      playNext();
    }

    return audioId;
  }

  /**
   * Play the next item in the queue
   */
  async function playNext() {
    if (queue.value.length === 0) {
      isPlaying.value = false;
      currentAudioId.value = null;
      return;
    }

    const ctx = getAudioContext();
    if (!ctx) return;

    const [nextItem, ...remaining] = queue.value;
    queue.value = remaining;

    currentAudioId.value = nextItem.id;
    isPlaying.value = true;
    options.onPlayStart?.();

    try {
      // Decode audio data
      const audioBuffer = await ctx.decodeAudioData(nextItem.audioData.slice(0));

      // Create source node
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(ctx.destination);

      // Handle playback end
      sourceNode.onended = () => {
        sourceNode = null;
        isPlaying.value = false;
        currentAudioId.value = null;
        options.onPlayEnd?.();

        // Play next item if available
        if (queue.value.length > 0) {
          playNext();
        }
      };

      // Start playback
      sourceNode.start(0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '音频解码失败';
      options.onError?.(error.value);
      isPlaying.value = false;
      currentAudioId.value = null;
      sourceNode = null;

      // Try to play next item even if this one failed
      if (queue.value.length > 0) {
        playNext();
      }
    }
  }

  /**
   * Clear the queue and stop current playback
   */
  function clear() {
    // Stop current playback
    if (sourceNode) {
      try {
        sourceNode.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      sourceNode = null;
    }

    // Clear queue
    queue.value = [];
    isPlaying.value = false;
    currentAudioId.value = null;
  }

  /**
   * Cleanup resources
   */
  function cleanup() {
    clear();
    if (audioContext) {
      audioContext.close().catch(() => {
        // Ignore close errors
      });
      audioContext = null;
    }
  }

  return {
    isPlaying,
    isSupported,
    currentAudioId,
    error,
    enqueue,
    playNext,
    clear,
    cleanup,
  };
}
