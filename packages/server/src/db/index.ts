// packages/server/src/db/index.ts
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: Database;
let SQL: SqlJsStatic;

// 确保数据目录存在
const dbDir = dirname(config.databasePath);
mkdirSync(dbDir, { recursive: true });

// 初始化数据库
export const initDatabase = async () => {
  SQL = await initSqlJs();

  // 尝试加载现有数据库
  if (existsSync(config.databasePath)) {
    const fileBuffer = readFileSync(config.databasePath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // 初始化表结构
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.run(schema);
  console.log('Database initialized');
};

// 保存数据库到文件
export const saveDatabase = () => {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(config.databasePath, buffer);
};

// 辅助函数：运行查询并返回结果
const queryAll = <T>(sql: string, params: (string | number | null)[] = []): T[] => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as T;
    results.push(row);
  }
  stmt.free();
  return results;
};

const queryOne = <T>(sql: string, params: (string | number | null)[] = []): T | undefined => {
  const results = queryAll<T>(sql, params);
  return results[0];
};

const runStatement = (sql: string, params: (string | number | null)[] = []): { lastInsertRowid: number; changes: number } => {
  db.run(sql, params);
  return {
    lastInsertRowid: Number(db.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] || 0),
    changes: db.getRowsModified()
  };
};

// 用户相关操作
export const userModel = {
  create: (username: string, passwordHash: string) => {
    const now = Date.now();
    const stmt = 'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)';
    const result = runStatement(stmt, [username, passwordHash, now, now]);
    saveDatabase();
    return { id: result.lastInsertRowid, username, created_at: now, updated_at: now };
  },

  findByUsername: (username: string) => {
    return queryOne<{
      id: number;
      username: string;
      password_hash: string;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM users WHERE username = ?', [username]);
  },

  findById: (id: number) => {
    return queryOne<{
      id: number;
      username: string;
      password_hash: string;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM users WHERE id = ?', [id]);
  },
};

// Agent 相关操作
export const agentModel = {
  create: (agentId: string, name: string | null, userId: number) => {
    const now = Date.now();
    const stmt = 'INSERT INTO agents (agent_id, name, user_id, created_at) VALUES (?, ?, ?, ?)';
    runStatement(stmt, [agentId, name, userId, now]);
    saveDatabase();
    return { agentId, name, userId, createdAt: now };
  },

  findByAgentId: (agentId: string) => {
    return queryOne<{
      id: number;
      agent_id: string;
      name: string | null;
      user_id: number;
      last_seen: number | null;
      created_at: number;
    }>('SELECT * FROM agents WHERE agent_id = ?', [agentId]);
  },

  findByUserId: (userId: number) => {
    return queryAll<{
      id: number;
      agent_id: string;
      name: string | null;
      user_id: number;
      last_seen: number | null;
      created_at: number;
    }>('SELECT * FROM agents WHERE user_id = ?', [userId]);
  },

  updateLastSeen: (agentId: string) => {
    runStatement('UPDATE agents SET last_seen = ? WHERE agent_id = ?', [Date.now(), agentId]);
    saveDatabase();
  },
};

// 刷新令牌相关操作
export const refreshTokenModel = {
  create: (userId: number, tokenHash: string, expiresAt: number) => {
    const now = Date.now();
    const stmt = 'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)';
    runStatement(stmt, [userId, tokenHash, expiresAt, now]);
    saveDatabase();
  },

  findByTokenHash: (tokenHash: string) => {
    return queryOne<{
      id: number;
      user_id: number;
      token_hash: string;
      expires_at: number;
      created_at: number;
    }>('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
  },

  deleteByTokenHash: (tokenHash: string) => {
    runStatement('DELETE FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
    saveDatabase();
  },

  deleteExpired: () => {
    runStatement('DELETE FROM refresh_tokens WHERE expires_at < ?', [Date.now()]);
    saveDatabase();
  },
};