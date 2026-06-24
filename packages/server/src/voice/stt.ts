// packages/server/src/voice/stt.ts
import https from 'https';

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
    console.log(`[STT] Buffer size: ${audioBuffer.length} bytes, chunks: ${this.buffer.length}`);
    this.clearBuffer();
    if (audioBuffer.length === 0) {
      console.log('[STT] Empty buffer, skipping transcription');
      return '';
    }
    return this.transcribe(audioBuffer);
  }

  private httpsPost(url: string, body?: string): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {},
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 500, data });
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  private async getAccessToken(): Promise<string> {
    // 如果 token 还有效（提前 5 分钟刷新），直接返回
    if (this.accessToken && Date.now() < this.tokenExpireTime - 300000) {
      return this.accessToken;
    }

    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.config.apiKey}&client_secret=${this.config.secretKey}`;

    const response = await this.httpsPost(url);
    if (response.status !== 200) {
      throw new Error(`Failed to get access token: HTTP ${response.status}`);
    }

    const data = response.data as { access_token?: string; expires_in?: number; error?: string };
    if (data.error || !data.access_token) {
      throw new Error(`Failed to get access token: ${data.error || 'no token in response'}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpireTime = Date.now() + (data.expires_in || 2592000) * 1000;

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
          dev_pid: 1537, // 中文普通话（支持英文）
          len: audioBuffer.length,
          speech: audioBase64,
        };

        console.log(`[STT] Sending to Baidu API: ${audioBuffer.length} bytes, base64 length: ${audioBase64.length}`);
        const response = await this.httpsPost(url, JSON.stringify(requestBody));
        console.log(`[STT] Baidu API response:`, JSON.stringify(response.data));

        if (response.status === 200) {
          const result = response.data as { err_no: number; result?: string[]; err_msg?: string };

          // 百度 API 返回 err_no = 0 表示成功
          if (result.err_no === 0 && result.result && result.result.length > 0) {
            console.log(`[STT] Transcription success: "${result.result[0]}"`);
            return result.result[0].trim();
          } else {
            throw new Error(`STT API error: err_no=${result.err_no}, err_msg=${result.err_msg}`);
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
        throw new Error(`STT API error ${response.status}: ${JSON.stringify(response.data)}`);
      } catch (err) {
        // 网络错误，重试
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
