# CCremote 推广内容

## 短推文版 (微博/推特)

```
🚀 重磅发布：CCremote - 手机远程控制 Windows 终端！

📱 手机浏览器直连，无需安装 APP
🔐 JWT 认证 + 用户管理，安全可靠
⚡ 多标签页 + 会话恢复，永不掉线
📁 文件上传下载，远程编程神器

无论你在哪里，Claude Code 任务随时执行！

GitHub: https://github.com/fangguoliang/claude-code-remote

#远程开发 #PowerShell #开源项目
```

---

## 长推文版 (知乎/公众号)

### 标题：手机变身远程终端！CCremote 让你在任何地方操控 Windows PowerShell

---

**你有没有遇到过这样的场景？**

- 正在运行的 Claude Code 任务突然需要调整参数
- 出差在外，急需查看服务器日志
- 躺在床上，想用手机跑个脚本

**CCremote 完美解决这些问题！**

---

## ✨ 核心特性

### 📱 手机原生体验

- **浏览器直连** - 无需安装任何 APP，打开浏览器即可使用
- **PWA 支持** - 可添加到手机桌面，像原生应用一样运行
- **响应式设计** - 完美适配手机屏幕，触摸操作流畅

### 🔐 企业级安全

- **JWT 认证** - 现代化的 Token 认证机制
- **用户管理** - Admin 可创建/禁用/删除用户
- **密码保护** - 支持修改密码，重置密码

### ⚡ 极致便捷

- **多标签页** - 同时开启多个终端会话
- **会话恢复** - 网络断开自动重连，会话不丢失
- **快捷键栏** - 底部 Tab、方向键、Ctrl+C 一键触达
- **自动登录** - 7天免登录，打开即用

### 📁 文件管理

- **上传文件** - 手机选择文件，一键上传到 Windows
- **下载文件** - 终端生成的文件，直接下载到手机
- **文件浏览** - 可视化文件目录，操作更直观

---

## 🛠 技术架构

```
手机浏览器 <--WebSocket--> Linux 云主机 <--WebSocket--> Windows Agent
```

**反向隧道架构**：Windows Agent 主动连接云服务器，无需公网 IP，无需端口转发！

---

## 🚀 快速部署

### 服务端 (Linux)

```bash
git clone https://github.com/fangguoliang/claude-code-remote
cd claude-code-remote/packages/server
cp .env.example .env
# 配置 JWT_SECRET 和 ADMIN_PASSWORD
pnpm install && pnpm build
pm2 start dist/index.js --name ccremote
```

### Agent (Windows)

```bash
cd packages/agent
cp .env.example .env
# 配置 SERVER_URL=ws://your-server:3000/ws/agent
pnpm install && pnpm build
# 使用 NSSM 注册为 Windows 服务
```

---

## 💡 使用场景

1. **远程执行 Claude Code 任务** - 让 AI 助手在服务器上持续工作
2. **移动运维** - 随时随地查看服务器状态
3. **远程调试** - 手机直接连接开发机调试
4. **自动化脚本** - 手机触发 Windows 定时任务

---

## 📸 界面预览

### 登录页面
简洁的登录界面，支持用户认证和密码修改

### 终端界面
- 完整的 PowerShell 终端体验
- 底部快捷键栏：Tab、↑、↓、Esc、Ctrl+C、Ctrl+L
- 多标签页切换
- 终端主题可自定义

### 设置页面
- API 地址配置
- 用户管理（Admin）
- 终端字体和主题设置

### 文件管理
- 文件浏览
- 上传/下载文件

---

## 🌟 为什么选择 CCremote？

| 特性 | CCremote | 传统方案 |
|------|----------|----------|
| 安装 | 浏览器直连 | 需要 SSH 客户端 |
| 网络要求 | 无需公网 IP | 需要端口转发/内网穿透 |
| 手机体验 | 原生优化 | 简单适配 |
| 会话恢复 | 自动 | 手动重连 |
| 文件管理 | 可视化 | 命令行 |

---

## 🔗 相关链接

- **GitHub**: https://github.com/fangguoliang/claude-code-remote
- **在线演示**: http://123.57.34.57
- **默认账号**: admin / (部署时设置的密码)

---

## 📄 开源协议

MIT License - 自由使用、修改、分发

---

**Star ⭐ 本项目，支持开源发展！**

---

## 推广图片建议

1. **封面图** - 手机屏幕显示终端 + 代码背景
2. **架构图** - 简洁的三端架构图
3. **功能展示** - 四宫格展示核心功能
4. **对比图** - 与传统方案的对比
5. **GIF 动图** - 终端操作演示