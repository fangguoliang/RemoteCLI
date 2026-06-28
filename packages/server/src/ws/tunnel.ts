// packages/server/src/ws/tunnel.ts
import WebSocket from 'ws';
import { agentModel } from '../db/index.js';

interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  userId: number;
  sessions: Map<string, WebSocket>; // sessionId -> browser ws
}

interface BrowserConnection {
  ws: WebSocket;
  userId: number;
  agentId: string | null;
  sessionId: string | null;
}

class TunnelManager {
  private agents = new Map<string, AgentConnection>();
  private browsers = new Map<WebSocket, BrowserConnection>();
  // Store session -> agentId mapping for session resumption
  private sessionAgents = new Map<string, string>();
  // Store agent -> browsers mapping for file operations
  private agentBrowsers = new Map<string, Set<WebSocket>>();

  // Agent 注册
  registerAgent(ws: WebSocket, agentId: string, userId: number) {
    const conn: AgentConnection = {
      ws,
      agentId,
      userId,
      sessions: new Map(),
    };
    this.agents.set(agentId, conn);
    agentModel.updateLastSeen(agentId);
    console.log(`Agent registered: ${agentId}`);
  }

  // Agent 断开
  unregisterAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) {
      // Close all browser sessions for this agent
      for (const [sessionId, browserWs] of agent.sessions) {
        browserWs.send(JSON.stringify({
          type: 'session:closed',
          sessionId,
          payload: { reason: 'Agent disconnected' },
          timestamp: Date.now(),
        }));
        // Clean up session mapping
        this.sessionAgents.delete(sessionId);
      }
      this.agents.delete(agentId);
    }
    console.log(`Agent unregistered: ${agentId}`);
  }

  // 浏览器连接
  connectBrowser(ws: WebSocket, userId: number) {
    const conn: BrowserConnection = {
      ws,
      userId,
      agentId: null,
      sessionId: null,
    };
    this.browsers.set(ws, conn);
  }

  // 浏览器断开 - 不再关闭会话，而是暂停会话
  disconnectBrowser(ws: WebSocket) {
    const browser = this.browsers.get(ws);
    console.log(`[tunnel] disconnectBrowser called, browser=${browser ? 'exists' : 'null'}, agentId=${browser?.agentId ?? 'null'}`);
    if (browser) {
      // Clean up voice session (handled in index.ts where voiceAgentManager is available)
      // voiceAgentManager?.removeSession(ws);

      // Clean up agentBrowsers mapping
      if (browser.agentId) {
        const browserSet = this.agentBrowsers.get(browser.agentId);
        if (browserSet) {
          const had = browserSet.has(ws);
          browserSet.delete(ws);
          console.log(`[tunnel] disconnectBrowser: removed from agentBrowsers[${browser.agentId}], had=${had}, remaining=${browserSet.size}`);
          if (browserSet.size === 0) {
            this.agentBrowsers.delete(browser.agentId);
          }
        }
      }

      if (browser.agentId && browser.sessionId) {
        // Store session -> agentId mapping for potential resume
        this.sessionAgents.set(browser.sessionId, browser.agentId);

        // Send session:pause to Agent instead of session:close
        const agent = this.agents.get(browser.agentId);
        if (agent) {
          agent.sessions.delete(browser.sessionId);
          agent.ws.send(JSON.stringify({
            type: 'session:pause',
            sessionId: browser.sessionId,
            payload: {},
            timestamp: Date.now(),
          }));
        }
      }
    }
    this.browsers.delete(ws);
  }

  // 恢复会话
  resumeSession(browserWs: WebSocket, sessionId: string): { success: boolean; agentId?: string; error?: string } {
    const agentId = this.sessionAgents.get(sessionId);
    if (!agentId) {
      return { success: false, error: 'Session not found' };
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      // Agent is offline, clean up the session mapping
      this.sessionAgents.delete(sessionId);
      return { success: false, error: 'Agent not connected' };
    }

    const browser = this.browsers.get(browserWs);
    if (!browser) {
      return { success: false, error: 'Browser not connected' };
    }

    // Re-bind browser to the session
    browser.sessionId = sessionId;
    browser.agentId = agentId;
    agent.sessions.set(sessionId, browserWs);

    return { success: true, agentId };
  }

  // 绑定浏览器到 Agent
  bindBrowserToAgent(ws: WebSocket, agentId: string): boolean {
    const browser = this.browsers.get(ws);
    if (browser && this.agents.has(agentId)) {
      const previousAgentId = browser.agentId;
      browser.agentId = agentId;
      // Add to agentBrowsers mapping for file operations
      if (!this.agentBrowsers.has(agentId)) {
        this.agentBrowsers.set(agentId, new Set());
      }
      const browserSet = this.agentBrowsers.get(agentId)!;
      const alreadyInSet = browserSet.has(ws);
      browserSet.add(ws);
      console.log(`[tunnel] bindBrowserToAgent: agentId=${agentId}, previousAgentId=${previousAgentId}, alreadyInSet=${alreadyInSet}, totalBrowsers=${browserSet.size}`);
      return true;
    }
    return false;
  }

  // 解绑浏览器与 Agent 的文件操作关联
  unbindBrowserFromAgent(ws: WebSocket): void {
    const browser = this.browsers.get(ws);
    if (browser && browser.agentId) {
      const browserSet = this.agentBrowsers.get(browser.agentId);
      if (browserSet) {
        browserSet.delete(ws);
        if (browserSet.size === 0) {
          this.agentBrowsers.delete(browser.agentId);
        }
      }
    }
  }

  // 创建会话
  createSession(browserWs: WebSocket, sessionId: string): boolean {
    const browser = this.browsers.get(browserWs);
    if (!browser || !browser.agentId) return false;

    const agent = this.agents.get(browser.agentId);
    if (!agent) return false;

    browser.sessionId = sessionId;
    agent.sessions.set(sessionId, browserWs);
    // Also set session -> agentId mapping for HTTP proxy (active session)
    this.sessionAgents.set(sessionId, browser.agentId);
    return true;
  }

  // 路由消息：浏览器 -> Agent
  routeToAgent(agentId: string, message: unknown): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false;

    agent.ws.send(JSON.stringify(message));
    return true;
  }

  // 路由消息：Agent -> 浏览器
  routeToBrowser(sessionId: string, message: unknown): boolean {
    for (const agent of this.agents.values()) {
      const browserWs = agent.sessions.get(sessionId);
      if (browserWs && browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify(message));
        return true;
      }
    }
    return false;
  }

  // 路由文件消息：Agent -> 所有绑定到该 Agent 的浏览器
  routeFileMessageToBrowsers(agentId: string, message: unknown): void {
    const browserSet = this.agentBrowsers.get(agentId);
    const msg = message as { type?: string; payload?: { chunkIndex?: number; totalChunks?: number; path?: string; content?: string } };
    const chunkInfo = msg?.payload?.chunkIndex !== undefined
      ? `chunk=${msg.payload.chunkIndex}/${msg.payload.totalChunks} contentLen=${msg.payload.content?.length ?? 0}`
      : '';
    console.log(`[tunnel] routeFileMessageToBrowsers: agent=${agentId} type=${msg?.type} ${chunkInfo} browsers=${browserSet?.size ?? 0}`);
    if (browserSet) {
      const messageStr = JSON.stringify(message);
      console.log(`[tunnel] serialized message size: ${messageStr.length} bytes`);
      let sentCount = 0;
      for (const browserWs of browserSet) {
        console.log(`[tunnel] browser ws readyState=${browserWs.readyState} (OPEN=1)`);
        if (browserWs.readyState === WebSocket.OPEN) {
          try {
            browserWs.send(messageStr);
            sentCount++;
            console.log(`[tunnel] send OK`);
          } catch (err) {
            console.error(`[tunnel] send FAILED:`, err);
          }
        } else {
          console.log(`[tunnel] SKIP: ws not open`);
        }
      }
      console.log(`[tunnel] sent ${sentCount}/${browserSet.size} browsers`);
    } else {
      console.log(`[tunnel] NO BROWSER SET for agent ${agentId}`);
    }
  }

  // 获取浏览器连接
  getBrowser(ws: WebSocket): BrowserConnection | undefined {
    return this.browsers.get(ws);
  }

  // 获取 Agent ID（通过 WebSocket）
  getAgentIdByWs(ws: WebSocket): string | undefined {
    for (const [agentId, conn] of this.agents) {
      if (conn.ws === ws) {
        return agentId;
      }
    }
    return undefined;
  }

  // 获取用户可用的 Agent 列表
  getUserAgents(userId: number) {
    return agentModel.findByUserId(userId);
  }

  // 检查 Agent 是否在线
  isAgentOnline(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  // 获取在线 Agents
  getOnlineAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  // 获取浏览器连接数
  getBrowserCount(): number {
    return this.browsers.size;
  }

  // 获取 Agent 连接数
  getAgentCount(): number {
    return this.agents.size;
  }

  // Get Agent WebSocket for a specific session (used by HTTP proxy)
  getAgentWebSocketForSession(sessionId: string): WebSocket | null {
    // Find agentId for this session
    const agentId = this.sessionAgents.get(sessionId);
    if (!agentId) return null;

    // Find agent WebSocket
    return this.agents.get(agentId)?.ws || null;
  }
}

export const tunnelManager = new TunnelManager();
export type { AgentConnection, BrowserConnection };