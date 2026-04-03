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

    ws.on('message', (data) => {
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