// packages/server/src/__tests__/stt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STTService } from '../voice/stt.js';

describe('STTService', () => {
  let stt: STTService;

  beforeEach(() => {
    vi.useFakeTimers();
    stt = new STTService({
      appId: 'test-app-id',
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key'
    });
  });

  it('should transcribe audio buffer to text', async () => {
    const mockTranscription = { err_no: 0, result: ['打开文件管理器'] };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'mock-token', expires_in: 2592000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTranscription),
      });

    const audioBuffer = Buffer.alloc(16000); // 1 second of silence
    const result = await stt.transcribe(audioBuffer);
    expect(result).toBe('打开文件管理器');
  });

  it('should throw on API error after retries', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'mock-token', expires_in: 2592000 }),
      })
      .mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

    const audioBuffer = Buffer.alloc(16000);

    // Use real timers for this test to avoid timing issues
    vi.useRealTimers();

    try {
      await stt.transcribe(audioBuffer);
      throw new Error('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('STT API error');
    }

    vi.useFakeTimers();
  }, 15000);

  it('should accumulate audio chunks', () => {
    const chunk1 = Buffer.alloc(1600);
    const chunk2 = Buffer.alloc(1600);
    stt.addChunk(chunk1);
    stt.addChunk(chunk2);
    expect(stt.getBufferSize()).toBe(3200);
  });

  it('should clear buffer after transcription', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'mock-token', expires_in: 2592000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ err_no: 0, result: ['test'] }),
      });

    stt.addChunk(Buffer.alloc(1600));
    await stt.transcribeBuffer();
    expect(stt.getBufferSize()).toBe(0);
  });
});
