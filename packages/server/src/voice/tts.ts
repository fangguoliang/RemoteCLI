// packages/server/src/voice/tts.ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

interface TTSConfig {
  voice: string;
  rate: string;
  maxLength?: number;
}

export class TTSService {
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!text.trim()) return Buffer.alloc(0);

    // Truncate if too long
    const maxLen = this.config.maxLength || 30;
    const truncated = text.length > maxLen ? text.substring(0, maxLen) : text;

    const tmpFile = join(tmpdir(), `tts-${randomUUID()}.mp3`);

    try {
      // Use edge-tts CLI (pip install edge-tts)
      await execFileAsync('edge-tts', [
        '--voice', this.config.voice,
        '--rate', this.config.rate,
        '--text', truncated,
        '--write-media', tmpFile,
      ]);

      const audio = await readFile(tmpFile);
      return audio;
    } catch (err) {
      console.error('TTS synthesis failed:', err);
      return Buffer.alloc(0);
    } finally {
      try { await unlink(tmpFile); } catch { /* ignore */ }
    }
  }
}
