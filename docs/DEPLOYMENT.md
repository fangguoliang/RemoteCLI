# remoteCli 部署手册

本文档详细介绍如何将 remoteCli 部署到生产环境。

---

## 目录

1. [环境要求](#环境要求)
2. [服务器部署](#服务器部署)
3. [Agent 部署](#agent-部署)
4. [前端部署](#前端部署)
5. [Nginx 配置](#nginx-配置)
6. [HTTPS 配置](#https-配置)
7. [进程管理](#进程管理)
8. [监控与日志](#监控与日志)

---

## 环境要求

### 服务器 (Linux)

| 组件 | 要求 |
|------|------|
| 操作系统 | Ubuntu 20.04+ / CentOS 8+ / Debian 11+ |
| Node.js | 18.x LTS 或更高 |
| pnpm | 8.x 或更高 |
| 内存 | 最低 512MB，推荐 1GB+ |
| 存储 | 最低 1GB |

### Windows Agent

| 组件 | 要求 |
|------|------|
| 操作系统 | Windows 10/11 或 Windows Server 2019+ |
| Node.js | 18.x LTS 或更高 |
| Visual Studio Build Tools | 用于编译 node-pty |

---

## 服务器部署

### 1. 安装 Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

### 2. 安装 pnpm

```bash
npm install -g pnpm
```

### 3. 克隆项目

```bash
git clone https://github.com/your-username/remotecli.git
cd remotecli
```

### 4. 安装依赖

```bash
pnpm install
```

### 5. 配置环境变量

```bash
cd packages/server
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 服务端口
PORT=3000

# JWT 密钥 (必须修改为强随机字符串)
JWT_SECRET=your-very-strong-random-secret-key-here

# 数据库路径
DATABASE_PATH=./data/remotecli.db

# 环境
NODE_ENV=production
```

### 6. 构建项目

```bash
cd packages/server
pnpm build
```

### 7. 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 创建 ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'remotecli-server',
    script: 'dist/index.js',
    cwd: '/path/to/remotecli/packages/server',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
EOF

# 启动服务
pm2 start ecosystem.config.js

# 设置开机自启
pm2 startup
pm2 save
```

---

## Agent 部署

### 1. 安装 Node.js (Windows)

下载并安装: https://nodejs.org/

### 2. 安装 Visual Studio Build Tools

1. 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
2. 运行安装程序
3. 选择「C++ 桌面开发」工作负载
4. 完成安装

### 3. 准备 Agent 文件

```powershell
# 创建目录
mkdir C:\remoteCli\agent

# 复制文件（从项目 packages/agent 目录）
# 或者直接克隆整个项目
```

### 4. 安装依赖

```powershell
cd C:\remoteCli\agent
npm install -g pnpm
pnpm install
```

### 5. 配置环境变量

创建 `C:\remoteCli\agent\.env`:

```env
# 服务器地址 (修改为你的服务器地址)
SERVER_URL=wss://your-server.com/ws/agent

# Agent ID (唯一标识，建议使用 UUID)
AGENT_ID=550e8400-e29b-41d4-a716-446655440000

# 用户 ID (在服务器上注册后获取)
USER_ID=1

# Agent 名称 (显示在前端)
AGENT_NAME=Office-PC
```

### 6. 构建

```powershell
pnpm build
```

### 7. 注册为 Windows 服务

使用 NSSM (Non-Sucking Service Manager):

```powershell
# 下载 NSSM
# https://nssm.cc/download

# 解压后运行
nssm install RemoteCliAgent

# 在 GUI 中配置:
# Application Path: C:\Program Files\nodejs\node.exe
# Startup Directory: C:\remoteCli\agent
# Arguments: dist\index.js

# 或者命令行配置:
nssm install RemoteCliAgent "C:\Program Files\nodejs\node.exe"
nssm set RemoteCliAgent AppDirectory "C:\remoteCli\agent"
nssm set RemoteCliAgent AppParameters "dist\index.js"
nssm set RemoteCliAgent DisplayName "remoteCli Agent"
nssm set RemoteCliAgent Description "Remote PowerShell Terminal Agent"
nssm set RemoteCliAgent Start SERVICE_AUTO_START

# 启动服务
nssm start RemoteCliAgent
```

### 8. 验证运行

```powershell
# 查看服务状态
nssm status RemoteCliAgent

# 查看日志
nssm logs RemoteCliAgent
```

---

## 前端部署

### 1. 配置环境变量

```bash
cd packages/web
```

创建 `.env.production`:

```env
VITE_API_URL=https://your-server.com
```

### 2. 构建

```bash
pnpm build
```

构建产物在 `dist/` 目录。

### 3. 部署静态文件

将 `dist/` 目录内容部署到任意静态文件服务器或 CDN。

---

## Nginx 配置

### 完整配置示例

```nginx
# /etc/nginx/sites-available/remotecli
server {
    listen 80;
    server_name your-server.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-server.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/your-server.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-server.com/privkey.pem;

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # 前端静态文件
    location / {
        root /var/www/remotecli/web/dist;
        try_files $uri $uri/ /index.html;

        # 缓存静态资源
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 代理
    location /ws/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 超时设置
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

启用配置:

```bash
sudo ln -s /etc/nginx/sites-available/remotecli /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## HTTPS 配置

### 使用 Let's Encrypt

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-server.com

# 自动续期
sudo certbot renew --dry-run
```

---

## 进程管理

### PM2 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs remotecli-server

# 重启服务
pm2 restart remotecli-server

# 停止服务
pm2 stop remotecli-server

# 监控
pm2 monit
```

### Windows 服务管理

```powershell
# 查看状态
sc query RemoteCliAgent

# 启动
net start RemoteCliAgent

# 停止
net stop RemoteCliAgent

# 重启
net stop RemoteCliAgent && net start RemoteCliAgent
```

---

## 监控与日志

### 服务器日志

```bash
# PM2 日志
pm2 logs remotecli-server

# 日志文件位置
~/.pm2/logs/remotecli-server-*.log
```

### Agent 日志

Windows 事件查看器:
- 应用程序和服务日志 → RemoteCliAgent

### 数据库备份

```bash
# 备份 SQLite 数据库
cp packages/server/data/remotecli.db packages/server/data/remotecli.db.backup

# 定时备份 (crontab)
0 2 * * * cp /path/to/remotecli/packages/server/data/remotecli.db /backup/remotecli-$(date +\%Y\%m\%d).db
```

---

## 安全加固

### 1. 防火墙配置

```bash
# Ubuntu UFW
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. 修改默认端口

修改 `.env` 中的 `PORT` 并更新 Nginx 配置。

### 3. 限制访问

```nginx
# 只允许特定 IP 访问管理接口
location /api/auth/register {
    allow 192.168.1.0/24;
    deny all;
    proxy_pass http://127.0.0.1:3000;
}
```

### 4. 定期更新

```bash
# 更新依赖
pnpm update

# 检查安全漏洞
pnpm audit
```

---

## 故障恢复

### 服务无法启动

1. 检查端口占用: `lsof -i :3000`
2. 检查日志: `pm2 logs remotecli-server`
3. 检查环境变量: `.env` 文件

### Agent 连接失败

1. 检查网络连通性
2. 检查服务器地址配置
3. 检查防火墙规则
4. 查看服务状态

### 数据库损坏

```bash
# 从备份恢复
cp /backup/remotecli-latest.db packages/server/data/remotecli.db
```

---

## 升级指南

```bash
# 停止服务
pm2 stop remotecli-server

# 拉取最新代码
git pull

# 安装依赖
pnpm install

# 构建
pnpm build

# 启动服务
pm2 start remotecli-server
```

---

## 联系支持

遇到部署问题请提交 Issue: https://github.com/your-username/remotecli/issues