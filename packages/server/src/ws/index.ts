// packages/server/src/ws/index.ts
import WebSocket, { WebSocketServer } from 'ws';
import { tunnelManager } from './tunnel.js';
import { handleMessage } from './router.js';
import type { FastifyInstance } from 'fastify';

export function setupWebSocket(fastify: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  // 处理升级请求
  fastify.server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';

    if (url.startsWith('/ws/browser')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (url.startsWith('/ws/agent')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const url = request.url || '';
    const isAgent = url.startsWith('/ws/agent');

    console.log(`WebSocket connected: ${isAgent ? 'agent' : 'browser'}`);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message, isAgent);
      } catch (err) {
        console.error('Failed to parse message:', err);
        ws.send(JSON.stringify({
          type: 'error',
          payload: { error: 'Invalid message format' },
          timestamp: Date.now(),
        }));
      }
    });

    ws.on('close', () => {
      if (isAgent) {
        // Agent 断开连接 - 需要从 tunnel manager 中移除
        // 我们需要找到对应的 agentId
        // 暂时留空，后续可以通过维护 ws -> agentId 的映射来处理
        console.log('Agent disconnected');
      } else {
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