// packages/server/src/ws/router.ts
import WebSocket from 'ws';
import { webcrypto } from 'crypto';
import { tunnelManager } from './tunnel.js';
import { agentModel, userModel, agentPermissionModel } from '../db/index.js';

const crypto = webcrypto;

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

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

    case 'session:resume':
      handleSessionResume(ws, sessionId, payload);
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
      console.log(`[router] session:started received, sessionId: ${sessionId}`);
      if (sessionId) {
        const result = tunnelManager.routeToBrowser(sessionId, message);
        console.log(`[router] session:started routed to browser: ${result}`);
      }
      break;

    case 'session:resumed':
      // Agent 确认会话已恢复，转发到浏览器
      if (sessionId) {
        tunnelManager.routeToBrowser(sessionId, message);
      }
      break;

    case 'file:browse':
    case 'file:download':
    case 'file:upload':
      // 浏览器发起的文件操作，路由到绑定的 Agent
      {
        console.log(`[file] ${type} received, payload:`, JSON.stringify(payload));
        // 如果 payload 中有 agentId，先绑定
        if (payload?.agentId) {
          const bindResult = tunnelManager.bindBrowserToAgent(ws, payload.agentId);
          console.log(`[file] bindBrowserToAgent result:`, bindResult);
        }
        const browser = tunnelManager.getBrowser(ws);
        console.log(`[file] browser:`, browser ? { agentId: browser.agentId, userId: browser.userId } : null);
        if (browser?.agentId) {
          console.log(`[file] routing to agent:`, browser.agentId);
          tunnelManager.routeToAgent(browser.agentId, message);
        } else {
          console.log(`[file] NO_AGENT error`);
          ws.send(JSON.stringify({
            type: 'file:error',
            payload: { code: 'NO_AGENT', message: 'No agent selected' },
            timestamp: Date.now(),
          }));
        }
      }
      break;

    case 'file:validate':
      // Browser requests path validation
      console.log(`[file] file:validate received, sessionId: ${sessionId}, payload:`, payload);
      if (sessionId) {
        const browser = tunnelManager.getBrowser(ws);
        console.log(`[file] browser for validate:`, browser ? { agentId: browser.agentId, userId: browser.userId } : null);
        if (browser?.agentId) {
          console.log(`[file] routing file:validate to agent:`, browser.agentId);
          tunnelManager.routeToAgent(browser.agentId, message);
        } else {
          ws.send(JSON.stringify({
            type: 'file:validated',
            payload: {
              originalPath: payload?.path,
              resolvedPath: '',
              exists: false,
              error: 'No agent session',
            },
            timestamp: Date.now(),
          }));
        }
      }
      break;

    case 'file:list':
    case 'file:data':
    case 'file:progress':
    case 'file:uploaded':
    case 'file:error':
      // Agent 返回的文件响应，路由到所有绑定到该 Agent 的浏览器
      if (isAgent) {
        const agentId = tunnelManager.getAgentIdByWs(ws);
        if (agentId) {
          tunnelManager.routeFileMessageToBrowsers(agentId, message);
        }
      } else if (sessionId) {
        // 兼容旧的 sessionId 方式
        tunnelManager.routeToBrowser(sessionId, message);
      }
      break;

    case 'file:validated':
      // Agent returns validation result to specific browser session
      console.log(`[file] file:validated received, isAgent: ${isAgent}, sessionId: ${sessionId}`);
      if (isAgent) {
        const agentId = tunnelManager.getAgentIdByWs(ws);
        console.log(`[file] file:validated agentId:`, agentId);
        // Route to all browsers connected to this agent (including fileWebSocket)
        if (agentId) {
          console.log(`[file] routing file:validated to browsers via agentBrowsers`);
          tunnelManager.routeFileMessageToBrowsers(agentId, message);
        }
        // Also try to route via session for terminal WebSocket
        if (sessionId) {
          console.log(`[file] routing file:validated to browser via sessionId: ${sessionId}`);
          tunnelManager.routeToBrowser(sessionId, message);
        }
      }
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      break;
  }
}

function handleAgentRegister(ws: WebSocket, payload: any) {
  const { agentId, username, name } = payload;

  // 验证必填字段
  if (!agentId) {
    ws.send(JSON.stringify({
      type: 'register:result',
      payload: { success: false, error: 'Missing agentId' },
      timestamp: Date.now(),
    }));
    return;
  }

  // 根据 username 查找用户，默认 admin
  const user = userModel.findByUsername(username || 'admin');
  if (!user) {
    ws.send(JSON.stringify({
      type: 'register:result',
      payload: { success: false, error: 'User not found' },
      timestamp: Date.now(),
    }));
    return;
  }

  // 确保 Agent 在数据库中存在
  let agent = agentModel.findByAgentId(agentId);
  if (!agent) {
    agent = agentModel.create(agentId, name || null, user.id);
  } else {
    // 更新 name、last_seen 和所有者（支持重连时转移归属）
    agentModel.updateOwner(agentId, name || null, user.id);
  }

  // 注册 Agent 到 TunnelManager
  tunnelManager.registerAgent(ws, agentId, user.id);

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
  const sessionId = generateUUID();
  const { cols, rows, agentId } = payload;

  // 如果消息中指定了 agentId，先绑定
  if (agentId) {
    tunnelManager.bindBrowserToAgent(ws, agentId);
  }

  // 获取浏览器信息用于权限验证
  const browser = tunnelManager.getBrowser(ws);
  if (!browser?.agentId) {
    ws.send(JSON.stringify({
      type: 'session:created',
      payload: { success: false, error: 'No agent selected' },
      timestamp: Date.now(),
    }));
    return;
  }

  // 验证用户是否有权限访问该 Agent
  const agent = agentModel.findByAgentId(browser.agentId);
  if (!agent) {
    ws.send(JSON.stringify({
      type: 'session:created',
      payload: { success: false, error: 'Agent not found' },
      timestamp: Date.now(),
    }));
    return;
  }

  // 检查权限：所有者或被授权用户
  const isOwner = agent.user_id === browser.userId;
  const hasSharedAccess = agentPermissionModel.hasPermission(browser.agentId, browser.userId);

  if (!isOwner && !hasSharedAccess) {
    ws.send(JSON.stringify({
      type: 'session:created',
      payload: { success: false, error: 'Permission denied' },
      timestamp: Date.now(),
    }));
    return;
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
  if (browser?.agentId && success) {
    const sent = tunnelManager.routeToAgent(browser.agentId, {
      type: 'session:start',
      sessionId,
      payload: { sessionId, cols, rows },
      timestamp: Date.now(),
    });

    if (!sent) {
      // Agent 不在线或连接已断开，通知浏览器失败
      ws.send(JSON.stringify({
        type: 'session:created',
        payload: { success: false, error: 'Agent connection lost' },
        timestamp: Date.now(),
      }));
      return;
    }
  }

  ws.send(JSON.stringify({
    type: 'session:created',
    payload: { sessionId, success },
    timestamp: Date.now(),
  }));
}

function handleSessionResume(ws: WebSocket, sessionId: string | undefined, payload: any) {
  if (!sessionId) {
    ws.send(JSON.stringify({
      type: 'session:resumed',
      payload: { success: false, error: 'Missing sessionId' },
      timestamp: Date.now(),
    }));
    return;
  }

  const { cols, rows } = payload;

  // Try to resume the session
  const result = tunnelManager.resumeSession(ws, sessionId);

  if (!result.success) {
    ws.send(JSON.stringify({
      type: 'session:resumed',
      sessionId,
      payload: { success: false, error: result.error },
      timestamp: Date.now(),
    }));
    return;
  }

  // Forward session:resume to Agent
  const sent = tunnelManager.routeToAgent(result.agentId!, {
    type: 'session:resume',
    sessionId,
    payload: { cols, rows },
    timestamp: Date.now(),
  });

  if (!sent) {
    // Agent connection lost after resumeSession succeeded
    ws.send(JSON.stringify({
      type: 'session:resumed',
      sessionId,
      payload: { success: false, error: 'Agent connection lost' },
      timestamp: Date.now(),
    }));
  }
}