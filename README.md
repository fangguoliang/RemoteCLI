# RemoteCLI

<div align="center">

**让终端触手可及 - 手机上的 PowerShell 自由之旅**

[![GitHub stars](https://img.shields.io/github/stars/fangguoliang/RemoteCLI?style=social)](https://github.com/fangguoliang/RemoteCLI)
[![GitHub forks](https://img.shields.io/github/forks/fangguoliang/RemoteCLI?style=social)](https://github.com/fangguoliang/RemoteCLI/fork)
[![GitHub license](https://img.shields.io/github/license/fangguoliang/RemoteCLI)](https://github.com/fangguoliang/RemoteCLI)

[English](#) | 简体中文

</div>

---

## 为什么选择 RemoteCLI？

你是否经历过这些时刻？

**约会中的紧急修复** - 周五晚上，你正和心仪的人共进晚餐。突然，线上服务挂了。如果有一种方式，能在手机上直接 SSH 进服务器排查问题，是不是就能优雅地处理完危机，继续享受美食？

**通勤路上的灵感时刻** - 早高峰的地铁上，你突然想到昨晚代码中的一个 bug。你想立刻验证修复方案，但地铁里打开笔记本电脑简直是奢望。如果手机能秒连终端，那些碎片时间就能变成 productive time。

**躺在床上写代码** - 凌晨两点，你刚躺下准备睡觉，脑子里突然冒出一个绝妙的实现思路。打开电脑？太麻烦了。如果手机就能连接到你的开发环境，躺着就能把灵感变成代码。

**外出时的服务器维护** - 你在咖啡馆、在公园、在机场。服务器需要重启一个服务，或者需要查看一下日志。以前你必须带着笔记本电脑，现在呢？

**RemoteCLI 为自由而生。**

---

## 核心特性

### 多终端同时管理
支持同时连接多个 Agent，一键切换。你可以管理家里的 NAS、公司服务器、云主机，所有终端集中在一个界面，无需多个 App。

### 跨平台会话集中管理
无论你使用 iOS Safari、Android Chrome、Windows/Mac/Linux 浏览器，都能获得一致的终端体验。一个账号，随处访问。

### 多用户多 Agent 管理
- 支持多用户独立账号
- 每个 Agent 可绑定特定用户
- 权限管理：控制谁能访问哪些 Agent
- Agent 自动注册：新机器一键接入

### 会话自动恢复
当你关闭浏览器，或手机锁屏，或网络断开 —— 终端会话不会丢失。30 分钟内重新连接，一切如初：
- 当前目录不变
- 命令历史保留
- 正在运行的程序也会继续执行

### 会话快捷方式
常用连接一键直达。你可以在主屏幕添加快捷方式，点击即刻进入指定终端。

### 文件上传下载
需要在服务器上传个脚本？或者下载日志文件分析？直接拖拽，简单直观。

### 用户权限管理
- 管理员可以管理所有用户
- 控制用户对 Agent 的访问权限
- 安全隔离，各司其职

### 快捷键加持
手机上也能用快捷键：`Ctrl+C` 中断命令、`Ctrl+D` 退出会话、支持自定义快捷键映射，外接键盘体验更佳。

---

## 为什么选择 RemoteCLI？

### 零配置穿透
传统远程访问需要公网 IP、端口转发、DDNS 服务或 VPN。RemoteCLI 采用 **反向隧道架构**：Agent 主动连接服务器，无需任何网络配置。即使你的电脑在 NAT 后面、在公司内网、在咖啡厅 WiFi 下，都能被访问。

### PWA 支持
添加到主屏幕，就像原生 App：全屏体验、离线缓存、推送通知（规划中）。

### 安全可靠
- JWT 身份认证
- WebSocket 加密传输
- 敏感信息加密存储
- 会话超时自动断开

---

## 架构

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│ 手机浏览器   │◄───►│ 云服务器        │◄───►│ Windows Agent│
│ (任意设备)   │  WS │ (中转节点)      │  WS │ (你的电脑)   │
└─────────────┘     └─────────────────┘     └─────────────┘
```

**反向隧道架构**: Windows Agent 主动连接云服务器，无需公网 IP 或端口转发。

---

## 快速开始

### 前置要求

- Node.js 18+
- pnpm 8+
- Windows: Visual Studio Build Tools (用于编译 node-pty)

### 1. 安装依赖

```bash
git clone https://github.com/fangguoliang/RemoteCLI.git
cd RemoteCLI

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

> **重要**: Agent 安装前必须先配置绑定的用户名！详见下方 [Agent 用户绑定](#agent-用户绑定)。

```bash
cd packages/agent
cp .env.example .env
# 编辑 .env 配置:
# SERVER_URL=ws://your-server:3000/ws/agent
# USERNAME=your-username  # 绑定到此用户，默认为 admin
# AGENT_ID=unique-agent-id  # 可选，不填则自动生成
pnpm dev
```

Agent 将自动连接服务器并等待终端会话请求。

#### Agent 环境变量说明

| 变量 | 描述 | 默认值 |
|------|------|--------|
| SERVER_URL | 服务器 WebSocket 地址 | 必填 |
| USERNAME | 绑定的用户名 | admin |
| AGENT_ID | Agent 唯一标识 | 自动生成 |
| SECRET | 注册密钥（需与服务器配置一致） | dev-secret |

#### Agent 用户绑定

**每个 Agent 必须绑定到一个用户**，只有该用户及其被授权的用户才能访问此 Agent。

**配置方法：**

1. 在服务器上先创建用户（通过 admin 账户或注册）
2. 编辑 Agent 的 `.env` 文件，设置 `USERNAME` 为目标用户名
3. 启动 Agent，它会自动绑定到该用户

**示例：**
```env
# .env
SERVER_URL=wss://your-server.com/ws/agent
USERNAME=test01
SECRET=your-secret
```

**权限说明：**
- Agent 所有者：完全控制 Agent
- 被授权用户：可通过 Admin 授权访问该 Agent
- Admin 用户：可管理所有 Agent 的权限

> **注意**：如果 Agent 已注册后修改 `USERNAME`，重启 Agent 会将所有权转移到新用户。

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

---

## 项目结构

```
RemoteCLI/
├── packages/
│   ├── shared/      # 共享 TypeScript 类型定义
│   ├── server/      # 云服务器端 (Node.js + Fastify + WebSocket)
│   ├── agent/       # Windows Agent (Node.js + node-pty + WebSocket)
│   └── web/         # 手机前端 (Vue 3 + xterm.js + PWA)
├── package.json
└── pnpm-workspace.yaml
```

---

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
| GET | /api/admin/agents | 获取所有 Agent 及所有者 |
| GET | /api/admin/agents/:agentId/permissions | 获取 Agent 授权用户 |
| GET | /api/admin/users/:userId/permissions | 获取用户可访问的 Agent |
| POST | /api/admin/agent-permissions | 批量授权用户访问 Agent |
| DELETE | /api/admin/agent-permissions | 批量撤销权限 |
| POST | /api/admin/agent-permissions/transfer-owner | 转移 Agent 所有权 |

### 健康检查

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/health | 服务健康状态 |

---

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

---

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

---

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

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | Vue 3, TypeScript, xterm.js, Pinia, Vue Router, Vite |
| 服务端 | Node.js, Fastify, ws, sql.js, bcrypt |
| Agent | Node.js, node-pty, ws |

---

## 适用人群

- **程序员**：随时随地写代码、查日志、修 bug
- **运维工程师**：7x24 服务器监控和故障处理
- **学生**：在宿舍、图书馆、教室都能访问实验室服务器
- **自由职业者**：真正的数字游民，咖啡店就是办公室
- **技术爱好者**：管理家里的 NAS、智能家居、自建服务

---

## 许可证

MIT

---

<div align="center">

**让终端，无处不在。**

如果这个项目对你有帮助，请给一个 ⭐ Star 支持一下！

</div>