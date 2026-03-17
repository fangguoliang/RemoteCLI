// packages/server/src/ws/router.ts
import WebSocket from 'ws';
import { tunnelManager } from './tunnel.js';
import { agentModel } from '../db/index.js';

export function handleMessage(ws: WebSocket, message: any, isAgent: boolean) {
  const { type, payload, sessionId } = message;

  switch (type) {
    case 'register':
      if (isAgent) {
        handleAgentRegister(ws, payload);
      }
      break;

    case 'auth':
      if (!isAgent) {
        handleBrowserAuth(ws, payload);
      }
      break;

    case 'session:create':
      handleSessionCreate(ws, payload);
      break;

    case 'session:input':
    case 'session:resize':
      // 转发到 Agent
      if (sessionId) {
        const browser = tunnelManager.getBrowser(ws);
        if (browser?.agentId) {
          tunnelManager.routeToAgent(browser.agentId, message);
        }
      }
      break;

    case 'session:output':
      // 转发到浏览器
      if (sessionId) {
        tunnelManager.routeToBrowser(sessionId, message);
      }
      break;

    case 'session:close':
      // 通知双方关闭会话
      if (sessionId) {
        const browser = tunnelManager.getBrowser(ws);
        if (browser?.agentId) {
          tunnelManager.routeToAgent(browser.agentId, message);
        }
      }
      break;

    case 'session:started':
      // Agent 确认会话已启动，转发到浏览器
      if (sessionId) {
        tunnelManager.routeToBrowser(sessionId, message);
      }
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      console.log(`Unknown message type: ${type}`);
  }
}

function handleAgentRegister(ws: WebSocket, payload: any) {
  const { agentId, userId, name } = payload;

  // 验证必填字段
  if (!agentId || !userId) {
    ws.send(JSON.stringify({
      type: 'register:result',
      payload: { success: false, error: 'Missing agentId or userId' },
      timestamp: Date.now(),
    }));
    return;
  }

  // 确保 Agent 在数据库中存在
  let agent = agentModel.findByAgentId(agentId);
  if (!agent) {
    agent = agentModel.create(agentId, name || null, userId);
  } else {
    // 更新 last_seen
    agentModel.updateLastSeen(agentId);
  }

  // 注册 Agent 到 TunnelManager
  tunnelManager.registerAgent(ws, agentId, userId);

  ws.send(JSON.stringify({
    type: 'register:result',
    payload: { success: true },
    timestamp: Date.now(),
  }));
}

function handleBrowserAuth(ws: WebSocket, payload: any) {
  const { userId, agentId } = payload;

  if (!userId) {
    ws.send(JSON.stringify({
      type: 'auth:result',
      payload: { success: false, error: 'Missing userId' },
      timestamp: Date.now(),
    }));
    return;
  }

  tunnelManager.connectBrowser(ws, userId);

  // 如果指定了 agentId，绑定到该 agent
  if (agentId) {
    const bound = tunnelManager.bindBrowserToAgent(ws, agentId);
    if (!bound) {
      ws.send(JSON.stringify({
        type: 'auth:result',
        payload: { success: false, error: 'Agent not online' },
        timestamp: Date.now(),
      }));
      return;
    }
  }

  ws.send(JSON.stringify({
    type: 'auth:result',
    payload: { success: true },
    timestamp: Date.now(),
  }));
}

function handleSessionCreate(ws: WebSocket, payload: any) {
  const sessionId = crypto.randomUUID();
  const { cols, rows, agentId } = payload;

  // 如果消息中指定了 agentId，先绑定
  if (agentId) {
    tunnelManager.bindBrowserToAgent(ws, agentId);
  }

  const success = tunnelManager.createSession(ws, sessionId);

  if (!success) {
    ws.send(JSON.stringify({
      type: 'session:created',
      payload: { success: false, error: 'Failed to create session. Agent not connected?' },
      timestamp: Date.now(),
    }));
    return;
  }

  // 通知 Agent 启动会话
  const browser = tunnelManager.getBrowser(ws);
  if (browser?.agentId && success) {
    tunnelManager.routeToAgent(browser.agentId, {
      type: 'session:start',
      sessionId,
      payload: { sessionId, cols, rows },
      timestamp: Date.now(),
    });
  }

  ws.send(JSON.stringify({
    type: 'session:created',
    payload: { sessionId, success },
    timestamp: Date.now(),
  }));
}