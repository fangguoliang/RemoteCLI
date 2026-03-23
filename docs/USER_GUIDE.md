# remoteCli 使用指南

## 简介

remoteCli 是一个远程 PowerShell 终端系统，允许您通过手机浏览器访问 Windows 电脑上的 PowerShell 终端。

## 系统架构

```
┌─────────────┐     WebSocket     ┌─────────────┐     WebSocket     ┌─────────────┐
│  手机浏览器  │ ←───────────────→ │  云服务器    │ ←───────────────→ │ Windows Agent│
│  (前端)     │                   │  (中转)     │                   │ (PowerShell) │
└─────────────┘                   └─────────────┘                   └─────────────┘
```

**反向隧道架构**: Windows Agent 主动连接云服务器，无需公网 IP 或端口转发。

---

## 快速开始

### 1. 安装依赖

```bash
# 克隆项目
git clone https://github.com/your-username/remotecli.git
cd remotecli

# 安装依赖
pnpm install

# 如果 node-pty 编译失败，运行：
pnpm approve-builds
# 然后选择 node-pty
```

### 2. 启动服务器

```bash
cd packages/server

# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
# JWT_SECRET=your-secret-key-here
# PORT=3000

# 启动服务器
pnpm dev
```

服务器启动后将监听：
- HTTP API: `http://localhost:3000/api/*`
- WebSocket (浏览器): `ws://localhost:3000/ws/browser`
- WebSocket (Agent): `ws://localhost:3000/ws/agent`

### 3. 启动 Windows Agent

```bash
cd packages/agent

# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
# SERVER_URL=ws://localhost:3000/ws/agent
# AGENT_ID=your-unique-agent-id
# USER_ID=1

# 启动 Agent
pnpm dev
```

Agent 启动后会自动连接服务器，显示 `Registration successful!` 表示连接成功。

### 4. 启动前端

```bash
cd packages/web
pnpm dev
```

前端启动后访问: `http://localhost:5173`

---

## 使用流程

### 第一步：注册账户

1. 打开浏览器访问前端地址
2. 点击「设置」确认 API 地址正确（默认 `http://localhost:3000`）
3. 返回登录页，点击注册
4. 输入用户名和密码（密码至少6位）

### 第二步：登录

使用注册的账户登录，系统会自动获取访问令牌。

### 第三步：选择 Agent

登录后进入终端页面：

1. 点击顶部「Agents」下拉菜单
2. 查看在线的 Agent（绿色圆点表示在线）
3. 点击 Agent 名称开始终端会话

### 第四步：使用终端

终端会话开始后：

- 输入命令并按回车执行
- 支持所有 PowerShell 命令
- 支持多标签页，点击「+」创建新会话

---

## 功能说明

### 多标签页

- 点击 Agent 创建新标签页
- 点击标签页切换会话
- 点击「×」关闭标签页

### 终端操作

| 操作 | 说明 |
|------|------|
| 输入命令 | 直接键入，回车执行 |
| Tab | 自动补全 |
| ↑/↓ | 历史命令 |
| Ctrl+C | 取消当前命令 |
| Ctrl+L | 清屏 |

### 设置

点击右上角「⚙」进入设置：

- **API 地址**: 服务器地址
- **主题**: 深色/浅色
- **字体**: 终端字体
- **字号**: 终端字号

### PWA 安装

支持将应用安装到手机桌面：

1. Chrome 浏览器访问前端
2. 点击菜单「添加到主屏幕」
3. 桌面出现 remoteCli 图标

---

## 常见问题

### Q: Agent 列表为空？

**A**: 确保 Agent 已启动并成功注册：
1. 检查 Agent 日志是否显示 `Registration successful!`
2. 确认 Agent 的 `USER_ID` 与登录用户 ID 匹配
3. 首次使用需要通过 API 创建用户

### Q: 终端无响应？

**A**: 检查以下项目：
1. Agent 是否在线（绿色圆点）
2. 服务器是否正常运行
3. 网络连接是否正常

### Q: node-pty 编译失败？

**A**: 需要安装 Visual Studio Build Tools：
1. 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
2. 安装时选择「C++ 桌面开发」工作负载
3. 重新运行 `pnpm install`

### Q: 如何修改端口？

**A**: 修改对应包的环境变量：
- 服务器: `packages/server/.env` 中的 `PORT`
- 前端: `packages/web/vite.config.ts` 中的配置

---

## 安全建议

1. **修改 JWT_SECRET**: 使用强随机字符串
2. **使用 HTTPS**: 生产环境必须使用 HTTPS
3. **限制访问**: 配置防火墙规则
4. **定期更新**: 保持依赖包最新

---

## 故障排除

### 查看日志

```bash
# 服务器日志
cd packages/server && pnpm dev

# Agent 日志
cd packages/agent && pnpm dev

# 前端日志
浏览器开发者工具 → Console
```

### 测试 API

```bash
# 健康检查
curl http://localhost:3000/api/health

# 注册用户
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# 登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'
```

---

## 联系支持

遇到问题请提交 Issue: https://github.com/your-username/remotecli/issues