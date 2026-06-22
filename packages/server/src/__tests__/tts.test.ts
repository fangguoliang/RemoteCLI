// packages/server/src/__tests__/tts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSService } from '../voice/tts.js';

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid',
}));

import { execFile } from 'child_process';
import { readFile, unlink } from 'fs/promises';

describe('TTSService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should synthesize text to audio buffer', async () => {
    vi.mocked(execFile).mockImplementation((cmd: any, args: any, callback: any) => {
      callback(null, { stdout: '', stderr: '' });
      return {} as any;
    });

    vi.mocked(readFile).mockResolvedValue(Buffer.from('mock-audio-data'));
    vi.mocked(unlink).mockResolvedValue();

    const tts = new TTSService({ voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%' });
    const audio = await tts.synthesize('搞定');

    expect(audio).toBeInstanceOf(Buffer);
    expect(audio.length).toBeGreaterThan(0);
    expect(execFile).toHaveBeenCalledWith('edge-tts', expect.arrayContaining([
      '--voice', 'zh-CN-XiaoxiaoNeural',
      '--rate', '+10%',
      '--text', '搞定',
    ]), expect.any(Function));
  });

  it('should truncate long text', async () => {
    vi.mocked(execFile).mockImplementation((cmd: any, args: any, callback: any) => {
      // Verify that text was truncated
      const textIndex = args.indexOf('--text');
      const text = args[textIndex + 1];
      expect(text.length).toBeLessThanOrEqual(10);
      callback(null, { stdout: '', stderr: '' });
      return {} as any;
    });

    vi.mocked(readFile).mockResolvedValue(Buffer.from('mock'));
    vi.mocked(unlink).mockResolvedValue();

    const tts = new TTSService({ voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%', maxLength: 10 });
    const audio = await tts.synthesize('这是一段很长很长的文字超过了最大长度限制');

    expect(audio).toBeInstanceOf(Buffer);
  });

  it('should return empty buffer for empty text', async () => {
    const tts = new TTSService({ voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%' });
    const audio = await tts.synthesize('');
    expect(audio.length).toBe(0);
    expect(execFile).not.toHaveBeenCalled();
  });
});
