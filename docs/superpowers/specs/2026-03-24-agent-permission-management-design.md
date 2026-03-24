# Agent 权限管理系统设计

日期：2026-03-24

## 背景

当前系统存在以下问题：
1. Agent 绑定到单一用户，新用户登录后没有可用 Agent
2. 没有权限管理机制，无法跨用户共享 Agent
3. 管理员无法灵活分配 Agent 访问权限

## 目标

1. Agent 安装时可指定所有者，默认归属 admin
2. 管理员可以授权其他用户访问 Agent
3. 一个 Agent 可被多个用户共享使用
4. 提供批量授权管理界面

## 设计决策

| 维度 | 决策 |
|------|------|
| Agent 所有权 | 每个 Agent 有唯一所有者，安装时通过 USERNAME 绑定，默认 admin |
| 权限粒度 | 简单开关（能/不能访问） |
| 多用户共享 | 平等共享，所有授权用户权限相同 |
| 管理界面 | 在 admin 设置页面增加 Agent 授权模块，支持按 Agent/用户双向查看权限 |
| 用户端显示 | 简洁视图，只显示有权限的 Agent |

## 实现方案

采用**最小改动方案**：在现有 `agents` 表基础上新增 `agent_permissions` 表存储共享权限。

### 数据库设计

**新增 `agent_permissions` 表**：

```sql
CREATE TABLE IF NOT EXISTS agent_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(agent_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_permissions_agent_id ON agent_permissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_permissions_user_id ON agent_permissions(user_id);
```

**说明**：
- 只存储"共享权限"，所有者仍由 `agents.user_id` 表示
- 所有者**不**在此表中，避免数据冗余，查询时需合并所有者和共享用户
- 同一 (agent_id, user_id) 组合唯一，避免重复授权
- 级联删除：Agent 或用户删除时自动清理权限记录

**数据模型** (`packages/server/src/db/index.ts`)：

```typescript
export const agentPermissionModel = {
  // 批量授权
  grant: (agentIds: string[], userIds: number[]) => void,
  // 批量移除权限
  revoke: (agentIds: string[], userIds: number[]) => void,
  // 查询 Agent 的共享用户列表
  findByAgentId: (agentId: string) => Array<{ user_id: number; username: string }>,
  // 查询用户被授权的 Agent 列表
  findByUserId: (userId: number) => Array<{ agent_id: string }>,
  // 检查用户是否有权限访问 Agent
  hasPermission: (agentId: string, userId: number) => boolean,
};
```

### API 设计

**新增管理接口**：

| 接口 | 方法 | 功能 |
|------|------|------|
| `/api/admin/agents` | GET | 获取所有 Agent 列表 |
| `/api/admin/agents/:agentId/permissions` | GET | 查看单个 Agent 的权限详情 |
| `/api/admin/users/:userId/permissions` | GET | 查看单个用户的权限详情 |
| `/api/admin/agent-permissions` | POST | 批量授权（笛卡尔积） |
| `/api/admin/agent-permissions` | DELETE | 批量移除权限 |
| `/api/admin/agent-permissions/transfer-owner` | POST | 转移所有者 |

**批量授权请求体（POST）**：
```json
{
  "userIds": [1, 2, 3],
  "agentIds": ["agent-a", "agent-b"]
}
```

**批量移除权限请求体（DELETE）**：
```json
{
  "userIds": [1, 2],
  "agentIds": ["agent-a"]
}
```

**转移所有者请求体**：
```json
{
  "agentId": "agent-a",
  "newOwnerId": 2
}
```

**查看 Agent 权限响应** (`GET /api/admin/agents/:agentId/permissions`)：
```json
{
  "agentId": "agent-a",
  "name": "Office-PC",
  "owner": { "id": 1, "username": "admin" },
  "sharedUsers": [
    { "id": 2, "username": "user1" },
    { "id": 3, "username": "user2" }
  ]
}
```

**查看用户权限响应** (`GET /api/admin/users/:userId/permissions`)：
```json
{
  "user": { "id": 2, "username": "user1" },
  "ownedAgents": [
    { "agentId": "agent-b", "name": "Home-PC" }
  ],
  "sharedAgents": [
    { "agentId": "agent-a", "name": "Office-PC" }
  ]
}
```

### Agent 安装流程

**配置修改** (`packages/agent/src/config.ts`)：
```typescript
username: process.env.USERNAME || 'admin',  // 默认绑定到 admin
```

**Server 注册处理** (`packages/server/src/ws/router.ts`)：
```typescript
// 接收 username 而非 userId
const { agentId, username, name } = payload;
// 查找用户
const user = userModel.findByUsername(username || 'admin');
if (!user) {
  // 用户不存在，拒绝注册
  return { success: false, error: 'User not found' };
}
// 绑定到用户
agentModel.create(agentId, name, user.id);
```

**行为**：
- 如果 `.env` 中配置了 `USERNAME=zhangsan`，Agent 归属该用户
- 如果没有配置或为空，Agent 自动归属 admin
- 普通用户只需知道自己的用户名，无需查询用户ID

### 管理界面交互设计

在 admin 设置页面中新增 **Agent 授权模块**，布局如下：

```
┌─────────────────────────────────────────────────────────────┐
│  Agent 授权管理                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ Agent 下拉选择  │    │ 用户下拉选择    │                │
│  │ [Office-PC  ▼] │    │ [user1     ▼]  │                │
│  └─────────────────┘    └─────────────────┘                │
│  [查看 Agent 权限]      [查看用户权限]                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 权限详情（多行文本框，只读）                              ││
│  │                                                          ││
│  │ [选择 Agent 时显示]                                      ││
│  │ Agent: Office-PC                                         ││
│  │ 所有者: admin                                            ││
│  │ 可使用用户: admin, user1, user2                          ││
│  │                                                          ││
│  │ [选择用户时显示]                                         ││
│  │ 用户: user1                                              ││
│  │ 拥有的 Agent: 无                                         ││
│  │ 可使用的 Agent: Office-PC, Home-PC                       ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ 用户多选下拉    │    │ Agent 多选下拉  │                │
│  │ [user1 ✓]      │    │ [Office-PC ✓]  │                │
│  │ [user2 ✓]      │    │ [Home-PC ✓]    │                │
│  │ [user3  ]      │    │ [Lab-PC   ]    │                │
│  └─────────────────┘    └─────────────────┘                │
│  [授权选中] [移除选中] [转移所有者]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**交互流程**：

1. **查看 Agent 权限**：
   - 选择一个 Agent，点击"查看 Agent 权限"
   - 下方文本框显示：所有者 + 可使用用户列表

2. **查看用户权限**：
   - 选择一个用户，点击"查看用户权限"
   - 下方文本框显示：拥有的 Agent + 可使用的 Agent

3. **批量授权**：
   - 多选用户 + 多选 Agent
   - 点击"授权选中"，建立笛卡尔积权限

4. **批量移除**：
   - 多选用户 + 多选 Agent
   - 点击"移除选中"，删除权限

5. **转移所有者**：
   - 选择单个 Agent + 单个用户
   - 点击"转移所有者"，更改 Agent 所有者

修改 `/api/agents` 接口，返回用户有权限访问的所有 Agent：

```typescript
// 伪代码
const ownedAgents = agentModel.findByUserId(userId);
const sharedAgents = agentPermissionModel.findByUserId(userId);
const allAgents = mergeAndDedupe(ownedAgents, sharedAgents);
```

### 权限验证

在创建会话时验证用户是否有权限访问目标 Agent：

1. 用户是 Agent 所有者 → 允许
2. 用户在 `agent_permissions` 表中有记录 → 允许
3. 否则 → 拒绝

## 影响范围

### 后端 (packages/server)
- `src/db/schema.sql` - 新增 agent_permissions 表
- `src/db/index.ts` - 新增 agentPermissionModel
- `src/routes/admin.ts` - 新增权限管理 API（含查看权限接口）
- `src/routes/auth.ts` - 修改 `/api/agents` 查询逻辑
- `src/ws/router.ts` - Agent 注册时支持 username 查找用户，会话创建时增加权限验证

### Agent (packages/agent)
- `src/config.ts` - 使用 USERNAME 环境变量，默认 'admin'
- `src/tunnel.ts` - 注册时发送 username 而非 userId

### 前端 (packages/web)
- 管理界面：在 admin 设置页面新增 Agent 授权模块
  - Agent/用户下拉选择
  - 权限查看功能（双向）
  - 批量授权/移除操作
  - 转移所有者功能
- 用户界面：Agent 列表显示"所有者"标识（可选）

## 测试要点

1. Agent 安装时使用 USERNAME 绑定用户，默认 admin
2. 用户名不存在时 Agent 注册失败
3. 查看 Agent 权限：显示所有者和共享用户列表
4. 查看用户权限：显示拥有的 Agent 和可使用的 Agent
5. 批量授权/移除权限的笛卡尔积正确性
6. 所有者转移后权限变化正确性
7. 用户只能看到有权限的 Agent
8. 无权限用户无法创建会话