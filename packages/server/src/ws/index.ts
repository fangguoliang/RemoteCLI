// packages/server/src/ws/index.ts
import WebSocket, { WebSocketServer } from 'ws';
import { tunnelManager } from './tunnel.js';
import { handleMessage } from './router.js';
import { voiceAgentManager } from '../index.js';
import type { FastifyInstance } from 'fastify';

export function setupWebSocket(fastify: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  // 处理升级请求
  fastify.server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    console.log(`[WS] Upgrade request received for URL: ${url}`);

    if (url.startsWith('/ws/browser')) {
      console.log(`[WS] Upgrading to browser WebSocket`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (url.startsWith('/ws/agent')) {
      console.log(`[WS] Upgrading to agent WebSocket`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      console.log(`[WS] Unknown URL, destroying connection`);
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const url = request.url || '';
    const isAgent = url.startsWith('/ws/agent');

    console.log(`WebSocket connected: ${isAgent ? 'agent' : 'browser'}, url: ${url}`);

    if (!isAgent) {
      // Log browser connection details
      console.log(`[WS] Browser WebSocket connected from url: ${url}`);
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary && !isAgent && voiceAgentManager) {
        // Handle binary audio messages
        // Format: [seq(4 bytes)][audio data]
        try {
          const buffer = Buffer.from(data as ArrayBuffer);
          if (buffer.length > 4) {
            const seq = buffer.readUInt32LE(0);
            const audioData = buffer.subarray(4);
            voiceAgentManager.handleAudioChunk(ws, audioData);
          }
        } catch (err) {
          console.error('Failed to process binary audio message:', err);
        }
      } else {
        // Handle JSON text messages
        try {
          const message = JSON.parse(data.toString());
          console.log(`[WS] Received message type: ${message.type} from ${isAgent ? 'agent' : 'browser'}`);
          handleMessage(ws, message, isAgent);
        } catch (err) {
          console.error('Failed to parse message:', err);
          ws.send(JSON.stringify({
            type: 'error',
            payload: { error: 'Invalid message format' },
            timestamp: Date.now(),
          }));
        }
      }
    });

    ws.on('close', () => {
      if (isAgent) {
        // Agent 断开连接 - 需要从 tunnel manager 中移除
        const agentId = tunnelManager.getAgentIdByWs(ws);
        if (agentId) {
          tunnelManager.unregisterAgent(agentId);
        }
        console.log('Agent disconnected');
      } else {
        // Clean up voice session
        voiceAgentManager?.removeSession(ws);
        tunnelManager.disconnectBrowser(ws);
        console.log('Browser disconnected');
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  return wss;
}