# CCremote 设计文档

> 远程 PowerShell 终端系统

## 概述

CCremote 是一个允许用户通过手机浏览器远程访问 Windows PowerShell 终端的系统。采用反向隧道架构，Windows 主动连接公网服务器，手机通过服务器中转访问终端。

## 架构

```
手机浏览器 <--WebSocket--> Linux 云主机 <--WebSocket--> Windows Agent
                              │                              │
                         中转服务端                      PowerShell 进程
```

## 组件

### 1. Web 前端

**技术栈：** Vue 3 + TypeScript + Vite + xterm.js + PWA

**功能：**
- 用户登录认证
- 多标签页终端
- 辅助键栏（Tab、方向键、Ctrl 组合键等）
- 终端主题和字体配置
- PWA 支持安装到桌面、自动登录

**目录结构：**
```
web/
├── src/
│   ├── views/          # 页面
│   ├── components/     # 组件
│   ├── stores/         # Pinia 状态管理
│   ├── services/       # WebSocket、API 服务
│   ├── utils/          # 工具函数
│   └── types/          # TypeScript 类型
├── public/
│   └── manifest.json   # PWA 配置
└── vite.config.ts
```

### 2. 中转服务端

**技术栈：** Node.js + TypeScript + Fastify + ws + SQLite

**功能：**
- 用户认证（JWT）
- Agent 注册与管理
- WebSocket 消息路由
- 会话管理

**目录结构：**
```
server/
├── src/
│   ├── routes/         # HTTP 路由
│   ├── ws/             # WebSocket 处理
│   ├── services/       # 业务服务
│   ├── db/             # 数据库
│   └── middleware/     # 中间件
└── package.json
```

### 3. Windows Agent

**技术栈：** Node.js + TypeScript + node-pty + ws

**功能：**
- 反向隧道连接（断线重连）
- PowerShell 进程管理（node-pty）
- 多会话支持
- 心跳保活

**目录结构：**
```
agent/
├── src/
│   ├── tunnel/         # 隧道管理
│   ├── pty/            # PTY 进程管理
│   ├── session/        # 会话管理
│   └── message/        # 消息处理
├── install.ps1         # Windows 服务安装脚本
└── package.json
```

## 通信协议

### WebSocket 消息格式

```typescript
interface Message {
  type: string;       // 消息类型
  payload: any;       // 消息内容
  sessionId?: string; // 会话ID
  timestamp: number;  // 时间戳
}
```

### 主要消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| auth | 浏览器→服务端 | 登录认证 |
| register | Agent→服务端 | Agent 注册 |
| session:create | 浏览器→服务端 | 创建新会话 |
| session:start | 服务端→Agent | 启动 PowerShell |
| session:input | 服务端→Agent | 终端输入 |
| session:output | Agent→服务端 | 终端输出 |
| session:close | 双向 | 关闭会话 |

## 数据库设计

```sql
-- 用户表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Agent 表
CREATE TABLE agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT UNIQUE NOT NULL,
    name TEXT,
    user_id INTEGER NOT NULL,
    last_seen INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 刷新令牌表
CREATE TABLE refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## 安全设计

1. **认证：** JWT + refresh token 机制
2. **密码存储：** bcrypt 加密
3. **Token 存储：** 前端 localStorage 加密存储
4. **通信加密：** WSS (WebSocket over TLS)
5. **Agent 认证：** Agent ID + Secret

## 终端交互

### 特殊按键映射

| 按键 | 序列 | 功能 |
|------|------|------|
| Tab | `\t` | 补全 |
| ↑↓ | `\x1b[A/B` | 历史命令 |
| Ctrl+C | `\x03` | 中断 |
| Ctrl+L | `\x0c` | 清屏 |

### 手机辅助键栏

提供虚拟快捷键：Esc、Tab、方向键、Home、End、Ctrl 组合键

## 部署

1. **Linux 云主机：** 部署 Nginx + Server
2. **Windows：** 安装 Agent，注册为系统服务
3. **手机：** 浏览器访问，PWA 安装

## 扩展功能

- 个性化配置：主题、字体大小
- 多标签页支持
- 自动登录（refresh token）