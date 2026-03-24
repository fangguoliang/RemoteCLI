import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import { authRoutes } from '../routes/auth.js';
import { adminRoutes } from '../routes/admin.js';
import { userModel, agentModel, agentPermissionModel, clearDatabase } from '../db/index.js';

async function buildServer() {
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: '*' });
  await fastify.register(jwt, { secret: 'test-secret-key-for-testing' });
  await fastify.register(authRoutes);
  await fastify.register(adminRoutes);
  return fastify;
}

describe('Agent Permissions', () => {
  beforeEach(() => {
    clearDatabase();
  });

  describe('POST /api/admin/agent-permissions', () => {
    it('should grant permissions to multiple users for multiple agents', async () => {
      const fastify = await buildServer();

      // Create admin and users
      const admin = userModel.create('admin', 'hash');
      const user1 = userModel.create('user1', 'hash');
      const user2 = userModel.create('user2', 'hash');
      agentModel.create('agent-1', 'Agent 1', admin.id);
      agentModel.create('agent-2', 'Agent 2', admin.id);

      // Login as admin
      const token = fastify.jwt.sign({ userId: admin.id, username: 'admin' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/admin/agent-permissions',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          userIds: [user1.id, user2.id],
          agentIds: ['agent-1', 'agent-2'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).success).toBe(true);

      // Verify permissions were created
      const shared1 = agentPermissionModel.findByAgentId('agent-1');
      expect(shared1.length).toBe(2);
    });
  });

  describe('DELETE /api/admin/agent-permissions', () => {
    it('should revoke permissions', async () => {
      const fastify = await buildServer();

      const admin = userModel.create('admin', 'hash');
      const user1 = userModel.create('user1', 'hash');
      agentModel.create('agent-1', 'Agent 1', admin.id);

      // Grant then revoke
      agentPermissionModel.grant(['agent-1'], [user1.id]);
      expect(agentPermissionModel.hasPermission('agent-1', user1.id)).toBe(true);

      const token = fastify.jwt.sign({ userId: admin.id, username: 'admin' });
      await fastify.inject({
        method: 'DELETE',
        url: '/api/admin/agent-permissions',
        headers: { Authorization: `Bearer ${token}` },
        payload: { userIds: [user1.id], agentIds: ['agent-1'] },
      });

      expect(agentPermissionModel.hasPermission('agent-1', user1.id)).toBe(false);
    });
  });

  describe('POST /api/admin/agent-permissions/transfer-owner', () => {
    it('should transfer agent ownership', async () => {
      const fastify = await buildServer();

      const admin = userModel.create('admin', 'hash');
      const user1 = userModel.create('user1', 'hash');
      agentModel.create('agent-1', 'Agent 1', admin.id);

      const token = fastify.jwt.sign({ userId: admin.id, username: 'admin' });
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/admin/agent-permissions/transfer-owner',
        headers: { Authorization: `Bearer ${token}` },
        payload: { agentId: 'agent-1', newOwnerId: user1.id },
      });

      expect(response.statusCode).toBe(200);

      const agent = agentModel.findByAgentId('agent-1');
      expect(agent?.user_id).toBe(user1.id);
    });
  });

  describe('hasPermission', () => {
    it('should return false for owner check (owner is not in permissions table)', async () => {
      const admin = userModel.create('admin', 'hash');
      agentModel.create('agent-1', 'Agent 1', admin.id);

      // Owner should NOT be in permissions table
      expect(agentPermissionModel.hasPermission('agent-1', admin.id)).toBe(false);
    });

    it('should return true for shared user', async () => {
      const admin = userModel.create('admin', 'hash');
      const user1 = userModel.create('user1', 'hash');
      agentModel.create('agent-1', 'Agent 1', admin.id);

      agentPermissionModel.grant(['agent-1'], [user1.id]);
      expect(agentPermissionModel.hasPermission('agent-1', user1.id)).toBe(true);
    });
  });
});