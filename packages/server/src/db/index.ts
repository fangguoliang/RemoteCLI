// packages/server/src/db/index.ts
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { config } from '../config/index.js';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: Database;
let SQL: SqlJsStatic;

// 确保数据目录存在 (unless using in-memory database)
if (config.databasePath !== ':memory:') {
  const dbDir = dirname(config.databasePath);
  mkdirSync(dbDir, { recursive: true });
}

// 初始化数据库
export const initDatabase = async () => {
  SQL = await initSqlJs();

  // 尝试加载现有数据库 (skip for in-memory)
  if (config.databasePath !== ':memory:' && existsSync(config.databasePath)) {
    const fileBuffer = readFileSync(config.databasePath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Check existing tables
  const existingTables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Existing tables before schema:', existingTables[0]?.values.map(v => v[0]).join(', ') || 'none');

  // 初始化表结构 - split schema into individual statements and execute each
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  const statements = schema.split(';').filter(s => s.trim().length > 0);
  for (const statement of statements) {
    try {
      db.run(statement.trim());
    } catch (err) {
      // Log but don't fail - some statements might fail if tables already exist
      console.log(`Schema statement warning: ${err}`);
    }
  }
  saveDatabase();

  // Check tables after schema
  const tablesAfter = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Tables after schema:', tablesAfter[0]?.values.map(v => v[0]).join(', ') || 'none');

  // 创建默认 admin 用户（如果不存在）
  const adminUser = userModel.findByUsername('admin');
  if (!adminUser) {
    const SALT_ROUNDS = 10;
    const passwordHash = await bcrypt.hash(config.adminPassword, SALT_ROUNDS);
    userModel.create('admin', passwordHash);
    console.log('Created default admin user');
  }

  console.log('Database initialized');
};

// 保存数据库到文件
export const saveDatabase = () => {
  if (config.databasePath === ':memory:') return; // Skip for in-memory database
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

  findAll: () => {
    return queryAll<{
      id: number;
      username: string;
      created_at: number;
    }>('SELECT id, username, created_at FROM users ORDER BY id');
  },

  updatePassword: (username: string, passwordHash: string) => {
    const now = Date.now();
    runStatement(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?',
      [passwordHash, now, username]
    );
    saveDatabase();
  },

  delete: (username: string) => {
    runStatement('DELETE FROM users WHERE username = ?', [username]);
    saveDatabase();
  },
};

// Agent 相关操作
export const agentModel = {
  create: (agentId: string, name: string | null, userId: number) => {
    const now = Date.now();
    const stmt = 'INSERT INTO agents (agent_id, name, user_id, created_at) VALUES (?, ?, ?, ?)';
    runStatement(stmt, [agentId, name, userId, now]);
    saveDatabase();
    return { id: 0, agent_id: agentId, name, user_id: userId, last_seen: null, created_at: now };
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

  findAll: () => {
    return queryAll<{
      id: number;
      agent_id: string;
      name: string | null;
      user_id: number;
      last_seen: number | null;
      created_at: number;
    }>('SELECT * FROM agents ORDER BY created_at DESC');
  },

  updateLastSeen: (agentId: string) => {
    runStatement('UPDATE agents SET last_seen = ? WHERE agent_id = ?', [Date.now(), agentId]);
    saveDatabase();
  },

  updateName: (agentId: string, name: string | null) => {
    runStatement('UPDATE agents SET name = ?, last_seen = ? WHERE agent_id = ?', [name, Date.now(), agentId]);
    saveDatabase();
  },

  updateOwner: (agentId: string, name: string | null, userId: number) => {
    runStatement(
      'UPDATE agents SET name = ?, user_id = ?, last_seen = ? WHERE agent_id = ?',
      [name, userId, Date.now(), agentId]
    );
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

// Agent 权限相关操作
export const agentPermissionModel = {
  // 批量授权（笛卡尔积）
  grant: (agentIds: string[], userIds: number[]) => {
    const now = Date.now();
    for (const agentId of agentIds) {
      for (const userId of userIds) {
        try {
          runStatement(
            'INSERT OR IGNORE INTO agent_permissions (agent_id, user_id, created_at) VALUES (?, ?, ?)',
            [agentId, userId, now]
          );
        } catch (e) {
          // 忽略重复插入错误
        }
      }
    }
    saveDatabase();
  },

  // 批量移除权限
  revoke: (agentIds: string[], userIds: number[]) => {
    for (const agentId of agentIds) {
      for (const userId of userIds) {
        runStatement(
          'DELETE FROM agent_permissions WHERE agent_id = ? AND user_id = ?',
          [agentId, userId]
        );
      }
    }
    saveDatabase();
  },

  // 查询 Agent 的共享用户列表
  findByAgentId: (agentId: string) => {
    return queryAll<{ user_id: number; username: string }>(
      `SELECT ap.user_id, u.username FROM agent_permissions ap
       JOIN users u ON ap.user_id = u.id
       WHERE ap.agent_id = ?`,
      [agentId]
    );
  },

  // 查询用户被授权的 Agent 列表
  findByUserId: (userId: number) => {
    return queryAll<{ agent_id: string; name: string | null }>(
      `SELECT a.agent_id, a.name FROM agent_permissions ap
       JOIN agents a ON ap.agent_id = a.agent_id
       WHERE ap.user_id = ?`,
      [userId]
    );
  },

  // 检查用户是否有权限访问 Agent
  hasPermission: (agentId: string, userId: number) => {
    const result = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_permissions WHERE agent_id = ? AND user_id = ?',
      [agentId, userId]
    );
    return (result?.count ?? 0) > 0;
  },
};

// 清空所有表 (用于测试)
export const clearDatabase = () => {
  db.run('DELETE FROM agent_permissions');
  db.run('DELETE FROM refresh_tokens');
  db.run('DELETE FROM agents');
  db.run('DELETE FROM users');
};