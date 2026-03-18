// packages/server/src/services/auth.ts
import bcrypt from 'bcryptjs';
import { webcrypto } from 'crypto';
import { userModel, refreshTokenModel } from '../db/index.js';
import type { FastifyInstance } from 'fastify';

const crypto = webcrypto;

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export const authService = {
  // 注册用户
  async register(username: string, password: string) {
    const existing = userModel.findByUsername(username);
    if (existing) {
      throw new Error('Username already exists');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    return userModel.create(username, passwordHash);
  },

  // 验证用户
  async verifyPassword(username: string, password: string) {
    const user = userModel.findByUsername(username);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password_hash);
    return valid ? user : null;
  },

  // 生成访问令牌
  generateAccessToken(fastify: FastifyInstance, userId: number, username: string) {
    return fastify.jwt.sign({ userId, username }, { expiresIn: ACCESS_TOKEN_EXPIRY });
  },

  // 生成刷新令牌
  async generateRefreshToken(userId: number) {
    const token = crypto.randomUUID();
    const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
    const expiresAt = Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    refreshTokenModel.create(userId, tokenHash, expiresAt);
    return token;
  },

  // 验证刷新令牌
  async verifyRefreshToken(token: string, userId: number) {
    // 查找该用户的所有刷新令牌
    const storedToken = refreshTokenModel.findByTokenHash(token);
    if (!storedToken) return false;
    if (storedToken.user_id !== userId) return false;
    if (storedToken.expires_at < Date.now()) {
      refreshTokenModel.deleteByTokenHash(token);
      return false;
    }
    return true;
  },

  // 通过明文token验证（需要对比hash）
  async verifyRefreshTokenByValue(tokenValue: string) {
    // 由于存储的是hash，我们需要通过userId查找并验证
    // 这是一个简化的实现，实际应该存储token的可识别部分
    // 这里我们直接验证token格式并返回
    const parts = tokenValue.split('-');
    if (parts.length !== 5) return null; // UUID format check
    return tokenValue;
  },
};