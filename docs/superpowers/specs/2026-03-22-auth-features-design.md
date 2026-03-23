# 认证功能扩展设计

日期: 2026-03-22

## 概述

为 remoteCli 添加用户注册、修改密码和管理员重置密码功能。

## 需求

1. **用户注册**: 仅管理员可创建用户，无公开注册入口
2. **修改密码**: 用户可在登录页修改自己的密码
3. **管理员重置密码**: admin 用户可在设置页重置任何用户的密码

## 权限模型

- `admin` 用户为管理员（硬编码判断）
- 无需添加数据库字段

## API 设计

### 新增端点

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/auth/change-password` | 修改自己的密码 | 无需 JWT，通过旧密码验证 |
| GET | `/api/admin/users` | 获取所有用户列表 | 仅 admin |
| POST | `/api/admin/users` | 创建新用户 | 仅 admin |
| POST | `/api/admin/reset-password` | 重置用户密码 | 仅 admin |

### 端点详情

#### POST /api/auth/change-password

此端点在登录页使用，无需 JWT。通过用户名和旧密码验证身份。

请求:
```json
{
  "username": "string",
  "oldPassword": "string",
  "newPassword": "string"
}
```

响应:
```json
{ "success": true }
```

错误: 用户不存在、旧密码错误、密码太短

#### GET /api/admin/users

响应:
```json
{
  "users": [
    { "id": 1, "username": "admin", "createdAt": 1234567890 }
  ]
}
```

#### POST /api/admin/users

请求:
```json
{
  "username": "string",
  "password": "string"
}
```

响应:
```json
{ "success": true, "userId": 2 }
```

错误: 用户名已存在、密码太短

#### POST /api/admin/reset-password

请求:
```json
{ "username": "string" }
```

响应:
```json
{ "success": true }
```

重置后的密码为用户名本身。

错误: 用户不存在

## 前端设计

### LoginView 变更

- 登录按钮下方添加"修改密码"链接
- 点击后切换为修改密码表单:
  - 用户名输入框
  - 旧密码输入框
  - 新密码输入框
  - 提交按钮
  - "返回登录"链接

### SettingsView 变更

现有设置项保持不变，新增"用户管理"区块（仅 admin 可见）:

1. **用户选择下拉框**: 从 `/api/admin/users` 获取用户列表
2. **重置密码按钮**: 重置选中用户的密码为用户名
3. **创建用户表单**:
   - 用户名输入框
   - 密码输入框
   - "创建用户"按钮

### Auth Store 扩展

新增方法:
```typescript
async changePassword(oldPassword: string, newPassword: string, apiUrl: string): Promise<void>
```

## 错误处理

### 验证规则

- 密码最少 6 个字符
- 用户名不能为空
- 不能创建重复用户名
- 修改密码需验证旧密码
- 非管理员访问 admin 端点返回 403

### 错误消息

| 场景 | 消息 |
|------|------|
| 用户名已存在 | 用户名已存在 |
| 旧密码错误 | 旧密码错误 |
| 密码太短 | 密码至少6个字符 |
| 无权限 | 无权限 |
| 用户不存在 | 用户不存在 |

### 成功消息

| 场景 | 消息 |
|------|------|
| 修改密码成功 | 密码修改成功 |
| 创建用户成功 | 用户创建成功 |
| 重置密码成功 | 密码已重置为用户名 |

## 数据库

无需修改 schema，现有 users 表已满足需求。

## 实现步骤

1. 后端: 添加 admin 中间件
2. 后端: 实现 `/api/auth/change-password`
3. 后端: 实现 admin 端点
4. 前端: Auth store 添加 changePassword
5. 前端: LoginView 添加修改密码表单
6. 前端: SettingsView 添加用户管理区块