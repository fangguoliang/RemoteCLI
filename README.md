# remoteCli

远程 PowerShell 终端系统 - 通过手机浏览器访问 Windows PowerShell。

## 架构

```
手机浏览器 <--WebSocket--> Linux 云主机 <--WebSocket--> Windows Agent
```

**反向隧道架构**: Windows Agent 主动连接云服务器，无需公网 IP 或端口转发。

## 项目结构

```
remoteCli/
├── packages/
│   ├── shared/      # 共享 TypeScript 类型定义
│   ├── server/      # 云服务器端 (Node.js + Fastify + WebSocket)
│   ├── agent/       # Windows Agent (Node.js + node-pty + WebSocket)
│   └── web/         # 手机前端 (Vue 3 + xterm.js + PWA)
├── package.json
└── pnpm-workspace.yaml
```

## 快速开始

### 前置要求

- Node.js 18+
- pnpm 8+
- Windows: Visual Studio Build Tools (用于编译 node-pty)

### 1. 安装依赖

```bash
pnpm install

# 如果 node-pty 编译失败，运行：
pnpm approve-builds
# 然后选择 node-pty
```

### 2. 启动服务端

```bash
cd packages/server
cp .env.example .env
# 编辑 .env 配置 JWT_SECRET 和 ADMIN_PASSWORD
pnpm dev
```

服务端将在端口 3000 启动，提供：
- HTTP API: `http://localhost:3000/api/*`
- WebSocket: `ws://localhost:3000/ws/browser`, `ws://localhost:3000/ws/agent`

#### 环境变量说明

| 变量 | 描述 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3000 |
| JWT_SECRET | JWT 签名密钥 | dev-secret-key |
| DATABASE_PATH | SQLite 数据库路径 | ./data/remotecli.db |
| ADMIN_PASSWORD | admin 用户初始密码 | admin |

> **重要**: 生产环境请务必修改 `JWT_SECRET` 和 `ADMIN_PASSWORD`！

### 3. 启动 Agent (Windows)

```bash
cd packages/agent
cp .env.example .env
# 编辑 .env 配置:
# SERVER_URL=ws://your-server:3000/ws/agent
# USER_ID=1
pnpm dev
```

Agent 将自动连接服务器并等待终端会话请求。

### 4. 启动前端

```bash
cd packages/web
pnpm dev
```

前端将在端口 5173 启动。

### 5. 访问

1. 打开浏览器访问 `http://localhost:5173`
2. 点击"设置"配置 API 地址
3. 注册新用户
4. 登录后点击 Agent 开始终端会话

## API 接口

### 认证

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /api/auth/register | 注册用户 |
| POST | /api/auth/login | 登录获取令牌 |
| POST | /api/auth/refresh | 刷新访问令牌 |
| POST | /api/auth/logout | 登出 |
| POST | /api/auth/change-password | 修改密码 |
| GET | /api/auth/me | 获取当前用户信息 |

### 管理员 (仅 admin 用户)

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/admin/users | 获取用户列表 |
| POST | /api/admin/users | 创建用户 |
| POST | /api/admin/reset-password | 重置用户密码为用户名 |
| POST | /api/admin/disable-user | 禁用用户 |
| POST | /api/admin/enable-user | 启用用户 |
| GET | /api/admin/user-status/:username | 查看用户状态 |
| POST | /api/admin/delete-user | 删除用户 |

### 健康检查

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/health | 服务健康状态 |

## WebSocket 协议

### 消息格式

```typescript
interface Message {
  type: MessageType;
  payload: unknown;
  sessionId?: string;
  timestamp: number;
}
```

### 消息类型

| 类型 | 方向 | 描述 |
|------|------|------|
| register | Agent -> Server | Agent 注册 |
| register:result | Server -> Agent | 注册结果 |
| auth | Browser -> Server | 浏览器认证 |
| auth:result | Server -> Browser | 认证结果 |
| session:create | Browser -> Server | 创建终端会话 |
| session:created | Server -> Browser | 会话创建结果 |
| session:start | Server -> Agent | 启动 PTY 会话 |
| session:started | Agent -> Server | 会话已启动 |
| session:input | Browser -> Agent | 终端输入 |
| session:output | Agent -> Browser | 终端输出 |
| session:resize | Browser -> Agent | 调整终端大小 |
| session:close | Both | 关闭会话 |
| ping/pong | Both | 心跳 |

## 开发

### 运行测试

```bash
cd packages/server
pnpm test
```

### 构建

```bash
# 构建所有包
pnpm build

# 构建单个包
cd packages/server && pnpm build
```

## 部署

### Linux 服务端

1. 构建并上传 server 包到服务器
2. 安装依赖: `pnpm install --prod`
3. 配置环境变量
4. 使用 PM2 管理进程:

```bash
pm2 start dist/index.js --name remotecli-server
```

5. Nginx 反向代理配置:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### Windows Agent

1. 安装 Node.js 18+
2. 复制 agent 包到目标机器
3. 安装依赖: `pnpm install --prod`
4. 配置 .env 文件
5. 使用 NSSM 注册为 Windows 服务:

```powershell
nssm install RemoteCliAgent "C:\Program Files\nodejs\node.exe"
nssm set RemoteCliAgent AppParameters "C:\path\to\agent\dist\index.js"
nssm set RemoteCliAgent AppDirectory "C:\path\to\agent"
nssm start RemoteCliAgent
```

## 功能特性

- 多标签页终端
- Tab 补全、方向键历史
- PWA 支持安装到手机桌面
- 自动登录 (刷新令牌)
- 主题和字体配置
- 快捷键栏 (Esc, Tab, 方向键, Ctrl+C, Ctrl+L)
- 自动重连
- 用户管理 (admin 可创建/禁用/删除用户)
- 修改密码功能

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | Vue 3, TypeScript, xterm.js, Pinia, Vue Router, Vite |
| 服务端 | Node.js, Fastify, ws, sql.js, bcrypt |
| Agent | Node.js, node-pty, ws |

## 许可证

MIT