import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import { authRoutes } from '../routes/auth.js';
import { adminRoutes } from '../routes/admin.js';
import { userModel } from '../db/index.js';

async function buildServer() {
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: '*' });
  await fastify.register(jwt, { secret: 'test-secret-key-for-testing' });
  await fastify.register(authRoutes);
  await fastify.register(adminRoutes);
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

  describe('POST /api/auth/change-password', () => {
    it('should change password with valid old password', async () => {
      const fastify = await buildServer();

      // Register user
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'changepwd', password: 'oldpass123' },
      });

      // Change password
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { username: 'changepwd', oldPassword: 'oldpass123', newPassword: 'newpass123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify can login with new password
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'changepwd', password: 'newpass123' },
      });
      expect(loginResponse.statusCode).toBe(200);
    });

    it('should reject wrong old password', async () => {
      const fastify = await buildServer();

      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'changepwd2', password: 'oldpass123' },
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { username: 'changepwd2', oldPassword: 'wrongpass', newPassword: 'newpass123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('旧密码错误');
    });

    it('should reject short new password', async () => {
      const fastify = await buildServer();

      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'changepwd3', password: 'oldpass123' },
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { username: 'changepwd3', oldPassword: 'oldpass123', newPassword: 'short' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('密码至少6个字符');
    });
  });

  describe('Admin endpoints', () => {
    it('should allow admin to list users', async () => {
      const fastify = await buildServer();

      // Create admin user directly
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'admin', password: 'admin123' },
      });

      // Login as admin
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Get users
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.users).toBeDefined();
      expect(body.users.length).toBeGreaterThan(0);
    });

    it('should reject non-admin from admin endpoints', async () => {
      const fastify = await buildServer();

      // Create non-admin user
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'normaluser', password: 'user123456' },
      });

      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'normaluser', password: 'user123456' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin to create user', async () => {
      const fastify = await buildServer();

      // Create and login as admin
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'admin', password: 'admin123' },
      });
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Create user
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { username: 'newuser', password: 'newpass123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.userId).toBeDefined();
    });

    it('should allow admin to reset password', async () => {
      const fastify = await buildServer();

      // Create admin and a test user
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'admin', password: 'admin123' },
      });
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'resetuser', password: 'oldpass123' },
      });

      // Login as admin
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Reset password
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/admin/reset-password',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { username: 'resetuser' },
      });

      expect(response.statusCode).toBe(200);

      // Verify can login with username as password
      const resetLogin = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'resetuser', password: 'resetuser' },
      });
      expect(resetLogin.statusCode).toBe(200);
    });
  });
});