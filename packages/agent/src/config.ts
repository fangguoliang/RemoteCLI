import 'dotenv/config';

export const config = {
  serverUrl: process.env.SERVER_URL || 'ws://localhost:3000/ws/agent',
  agentId: process.env.AGENT_ID || crypto.randomUUID(),
  agentSecret: process.env.AGENT_SECRET || 'dev-secret',
  username: process.env.USERNAME || 'admin',  // 使用用户名，默认 admin
  reconnectInterval: 5000,
  heartbeatInterval: 30000,
};