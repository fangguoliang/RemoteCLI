// 测试脚本：模拟发送语音数据到服务器
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const SERVER_URL = 'wss://123.57.34.57/ws/browser';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiaWF0IjoxNzgyMTc4MzE1LCJleHAiOjE3ODIxODU1MTV9.placeholder'; // 需要从浏览器获取真实的 token

// 生成测试 PCM 音频（1秒静音 + 简单正弦波模拟语音）
function generateTestAudio() {
  const sampleRate = 16000;
  const duration = 2; // 2秒
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(numSamples * 2); // 16-bit = 2 bytes per sample
  const view = new DataView(buffer);

  // 前 0.5 秒静音
  const silenceSamples = sampleRate * 0.5;
  for (let i = 0; i < silenceSamples; i++) {
    view.setInt16(i * 2, 0, true);
  }

  // 后 1.5 秒正弦波（模拟语音）
  const waveSamples = numSamples - silenceSamples;
  const frequency = 440; // A4 音符
  for (let i = 0; i < waveSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 10000; // 振幅
    view.setInt16((silenceSamples + i) * 2, sample, true);
  }

  return Buffer.from(buffer);
}

async function runTest() {
  console.log('[Test] Connecting to server...');

  const ws = new WebSocket(SERVER_URL, {
    rejectUnauthorized: false // 跳过证书验证
  });

  ws.on('open', () => {
    console.log('[Test] Connected, sending auth...');

    // 发送认证消息（需要先获取有效的 JWT token）
    ws.send(JSON.stringify({
      type: 'auth',
      payload: { userId: '1', agentId: 'windows-main' },
      timestamp: Date.now()
    }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[Test] Received:', msg.type, msg.payload);

    if (msg.type === 'auth:result' && msg.payload.success) {
      console.log('[Test] Auth success, sending voice:start...');

      // 发送 voice:start
      ws.send(JSON.stringify({
        type: 'voice:start',
        payload: { sampleRate: 16000 },
        timestamp: Date.now()
      }));

      // 生成并发送测试音频
      const audio = generateTestAudio();
      console.log('[Test] Generated test audio:', audio.length, 'bytes');

      // 分块发送（每块 4096 bytes）
      const chunkSize = 4096;
      let seq = 0;
      for (let offset = 0; offset < audio.length; offset += chunkSize) {
        const chunk = audio.slice(offset, offset + chunkSize);

        // 创建二进制消息：[seq(4 bytes)][audio data]
        const buffer = new ArrayBuffer(4 + chunk.length);
        const view = new DataView(buffer);
        view.setUint32(0, seq, true);
        new Uint8Array(buffer, 4).set(chunk);

        ws.send(buffer);
        seq++;
      }

      console.log('[Test] Sent', seq, 'audio chunks');

      // 发送 voice:vad-state (speaking: false)
      setTimeout(() => {
        console.log('[Test] Sending voice:vad-state (end of speech)...');
        ws.send(JSON.stringify({
          type: 'voice:vad-state',
          payload: { speaking: false, reason: 'silence' },
          timestamp: Date.now()
        }));
      }, 1000);

      // 发送 voice:end
      setTimeout(() => {
        console.log('[Test] Sending voice:end...');
        ws.send(JSON.stringify({
          type: 'voice:end',
          payload: {},
          timestamp: Date.now()
        }));

        setTimeout(() => {
          console.log('[Test] Test complete, closing connection...');
          ws.close();
          process.exit(0);
        }, 2000);
      }, 2000);
    }
  });

  ws.on('error', (err) => {
    console.error('[Test] WebSocket error:', err.message);
    process.exit(1);
  });

  ws.on('close', () => {
    console.log('[Test] Connection closed');
  });
}

runTest().catch(console.error);
