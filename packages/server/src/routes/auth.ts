// packages/server/src/routes/auth.ts
import { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.js';
import { userModel, refreshTokenModel, agentModel, agentPermissionModel } from '../db/index.js';
import { tunnelManager } from '../ws/tunnel.js';

export async function authRoutes(fastify: FastifyInstance) {
  // 注册
  fastify.post('/api/auth/register', async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    if (password.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' });
    }

    try {
      const user = await authService.register(username, password);
      return { success: true, userId: user.id };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // 登录
  fastify.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const user = await authService.verifyPassword(username, password);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const accessToken = authService.generateAccessToken(fastify, user.id, user.username);
    const refreshToken = await authService.generateRefreshToken(user.id);

    return {
      success: true,
      accessToken,
      refreshToken,
      userId: user.id,
      username: user.username,
    };
  });

  // 刷新令牌
  fastify.post('/api/auth/refresh', async (request, reply) => {
    const { refreshToken, userId } = request.body as { refreshToken: string; userId: number };

    if (!refreshToken || !userId) {
      return reply.status(400).send({ error: 'Refresh token and user ID required' });
    }

    // 验证用户存在
    const user = userModel.findById(userId);
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    // 生成新的访问令牌
    const accessToken = authService.generateAccessToken(fastify, user.id, user.username);
    const newRefreshToken = await authService.generateRefreshToken(user.id);

    return {
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
    };
  });

  // 修改密码
  fastify.post('/api/auth/change-password', async (request, reply) => {
    const { username, oldPassword, newPassword } = request.body as {
      username: string;
      oldPassword: string;
      newPassword: string;
    };

    if (!username || !oldPassword || !newPassword) {
      return reply.status(400).send({ error: '所有字段必填' });
    }

    try {
      await authService.changePassword(username, oldPassword, newPassword);
      return { success: true };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // 登出
  fastify.post('/api/auth/logout', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };

    // 在实际实现中，应该存储token hash并删除
    // 这里简化处理
    return { success: true };
  });

  // 获取当前用户信息
  fastify.get('/api/auth/me', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }
  }, async (request, reply) => {
    const payload = request.user as { userId: number; username: string };
    const user = userModel.findById(payload.userId);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return {
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
    };
  });

  // 获取用户的 Agent 列表
  fastify.get('/api/agents', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }
  }, async (request, reply) => {
    const payload = request.user as { userId: number; username: string };

    // 获取用户拥有的 Agent
    const ownedAgents = agentModel.findByUserId(payload.userId);

    // 获取用户被授权的 Agent
    const sharedAgents = agentPermissionModel.findByUserId(payload.userId);

    // 合并去重
    const agentMap = new Map<string, { agentId: string; name: string | null; online: boolean; lastSeen: number | null; isOwner: boolean }>();

    for (const agent of ownedAgents) {
      agentMap.set(agent.agent_id, {
        agentId: agent.agent_id,
        name: agent.name,
        online: tunnelManager.isAgentOnline(agent.agent_id),
        lastSeen: agent.last_seen,
        isOwner: true,
      });
    }

    for (const agent of sharedAgents) {
      if (!agentMap.has(agent.agent_id)) {
        agentMap.set(agent.agent_id, {
          agentId: agent.agent_id,
          name: agent.name,
          online: tunnelManager.isAgentOnline(agent.agent_id),
          lastSeen: null,
          isOwner: false,
        });
      }
    }

    return { agents: Array.from(agentMap.values()) };
  });
}