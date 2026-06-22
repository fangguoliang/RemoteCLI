// packages/server/src/voice/stt.ts

interface STTConfig {
  appId: string;
  apiKey: string;
  secretKey: string;
}

export class STTService {
  private buffer: Buffer[] = [];
  private config: STTConfig;
  private maxBufferSize: number; // P2 修复：防止内存泄漏
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;

  constructor(cfg: STTConfig, maxBufferSize: number = 960_000) {
    this.config = cfg;
    this.maxBufferSize = maxBufferSize; // 默认 60 秒 @ 16kHz 16-bit = ~960KB
  }

  addChunk(chunk: Buffer) {
    this.buffer.push(chunk);

    // P2 修复：超过最大 buffer 大小时丢弃最早的 chunk
    while (this.getBufferSize() > this.maxBufferSize && this.buffer.length > 1) {
      this.buffer.shift();
    }
  }

  getBufferSize(): number {
    return this.buffer.reduce((sum, b) => sum + b.length, 0);
  }

  clearBuffer() {
    this.buffer = [];
  }

  async transcribeBuffer(): Promise<string> {
    const audioBuffer = Buffer.concat(this.buffer);
    this.clearBuffer();
    if (audioBuffer.length === 0) return '';
    return this.transcribe(audioBuffer);
  }

  private async getAccessToken(): Promise<string> {
    // 如果 token 还有效（提前 5 分钟刷新），直接返回
    if (this.accessToken && Date.now() < this.tokenExpireTime - 300000) {
      return this.accessToken;
    }

    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.config.apiKey}&client_secret=${this.config.secretKey}`;

    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpireTime = Date.now() + data.expires_in * 1000;

    return this.accessToken;
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1秒

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const token = await this.getAccessToken();

        // 百度 AI 语音识别 API
        const url = `https://vop.baidu.com/server_api`;

        // 将 PCM 音频转换为 base64
        const audioBase64 = audioBuffer.toString('base64');

        const requestBody = {
          format: 'pcm',
          rate: 16000,
          channel: 1,
          cuid: 'remotecli-voice',
          token: token,
          dev_pid: 80001, // 中文普通话模型
          len: audioBuffer.length,
          speech: audioBase64,
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          const result = await response.json() as { err_no: number; result?: string[] };

          // 百度 API 返回 err_no = 0 表示成功
          if (result.err_no === 0 && result.result && result.result.length > 0) {
            return result.result[0].trim();
          } else {
            throw new Error(`STT API error: err_no=${result.err_no}`);
          }
        }

        // 可重试的错误（5xx 或网络错误）
        if (response.status >= 500 && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt); // 指数退避：1s, 2s, 4s
          console.log(`[STT] API error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // 不可重试的错误或重试次数用尽
        throw new Error(`STT API error ${response.status}: ${await response.text()}`);
      } catch (err) {
        // 网络错误（fetch 抛出的异常），重试
        if (attempt === maxRetries) {
          throw err;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[STT] Network error: ${(err as Error).message}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('STT transcription failed after retries');
  }
}
