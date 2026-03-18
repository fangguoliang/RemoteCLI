import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import { authRoutes } from '../routes/auth.js';
import { userModel } from '../db/index.js';

async function buildServer() {
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: '*' });
  await fastify.register(jwt, { secret: 'test-secret-key-for-testing' });
  await fastify.register(authRoutes);
  return fastify;
}

describe('Authentication', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const fastify = await buildServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'testuser', password: 'test123456' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.userId).toBeDefined();
    });

    it('should reject missing username', async () => {
      const fastify = await buildServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { password: 'test123456' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject short password', async () => {
      const fastify = await buildServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'testuser2', password: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const fastify = await buildServer();

      // First register
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'loginuser', password: 'test123456' },
      });

      // Then login
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'loginuser', password: 'test123456' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const fastify = await buildServer();

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'nonexistent', password: 'wrongpass' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return user info with valid token', async () => {
      const fastify = await buildServer();

      // Register and login
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'meuser', password: 'test123456' },
      });

      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'meuser', password: 'test123456' },
      });

      const { accessToken } = JSON.parse(loginResponse.body);

      // Get user info
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.username).toBe('meuser');
    });

    it('should reject without token', async () => {
      const fastify = await buildServer();

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});