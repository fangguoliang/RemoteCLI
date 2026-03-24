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
| Agent 所有权 | 每个 Agent 有唯一所有者，安装时通过 USER_ID 绑定，默认 admin |
| 权限粒度 | 简单开关（能/不能访问） |
| 多用户共享 | 平等共享，所有授权用户权限相同 |
| 管理界面 | 用户×Agent 笛卡尔积批量操作，可选操作类型，显示当前权限清单 |
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
| `/api/admin/agents` | GET | 获取所有 Agent 列表（含所有者、共享用户清单） |
| `/api/admin/agent-permissions` | POST | 批量授权（笛卡尔积） |
| `/api/admin/agent-permissions` | DELETE | 批量移除权限 |
| `/api/admin/agent-permissions/transfer-owner` | POST | 转移所有者 |

**批量授权请求体**：
```json
{
  "userIds": [1, 2, 3],
  "agentIds": ["agent-a", "agent-b"],
  "action": "grant"
}
```

**转移所有者请求体**：
```json
{
  "agentId": "agent-a",
  "newOwnerId": 2
}
```

**Agent 列表响应示例**：
```json
{
  "agents": [
    {
      "agentId": "agent-a",
      "name": "Office-PC",
      "online": true,
      "ownerId": 1,
      "ownerName": "admin",
      "sharedUsers": [
        { "id": 2, "username": "user1" },
        { "id": 3, "username": "user2" }
      ],
      "lastSeen": 1711234567890,
      "createdAt": 1711000000000
    }
  ]
}
```

### Agent 安装流程

**配置修改** (`packages/agent/src/config.ts`)：
```typescript
userId: parseInt(process.env.USER_ID || '1', 10),  // 默认绑定到 admin
```

**行为**：
- 如果 `.env` 中配置了 `USER_ID=123`，Agent 归属该用户
- 如果没有配置或为空，Agent 自动归属 admin (userId=1)

### 用户 Agent 查询逻辑

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
- `src/routes/admin.ts` - 新增权限管理 API
- `src/routes/auth.ts` - 修改 `/api/agents` 查询逻辑
- `src/ws/router.ts` - 会话创建时增加权限验证

### Agent (packages/agent)
- `src/config.ts` - USER_ID 默认值改为 1

### 前端 (packages/web)
- 管理界面：新增 Agent 权限管理页面
- 用户界面：Agent 列表显示"所有者"标识（可选）

## 测试要点

1. Agent 安装时指定 USER_ID 与默认行为的正确性
2. 批量授权/移除权限的笛卡尔积正确性
3. 所有者转移后权限变化正确性
4. 用户只能看到有权限的 Agent
5. 无权限用户无法创建会话