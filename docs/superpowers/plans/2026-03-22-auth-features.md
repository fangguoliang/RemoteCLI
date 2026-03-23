# Auth Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user registration (admin only), password change, and admin password reset features.

**Architecture:** Backend adds change-password and admin endpoints. Frontend adds change-password form toggle on LoginView and user management section on SettingsView (admin only).

**Tech Stack:** Fastify, bcryptjs, Vue 3, Pinia, TypeScript

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/server/src/db/index.ts` | Modify | Add `userModel.findAll()`, `userModel.updatePassword()` |
| `packages/server/src/services/auth.ts` | Modify | Add `changePassword()` method |
| `packages/server/src/routes/auth.ts` | Modify | Add `POST /api/auth/change-password` endpoint |
| `packages/server/src/routes/admin.ts` | Create | Admin endpoints (users list, create, reset password) |
| `packages/server/src/index.ts` | Modify | Register admin routes |
| `packages/server/src/__tests__/auth.test.ts` | Modify | Tests for new endpoints |
| `packages/web/src/stores/auth.ts` | Modify | Add `changePassword()` function |
| `packages/web/src/views/LoginView.vue` | Modify | Add change-password form toggle |
| `packages/web/src/views/SettingsView.vue` | Modify | Add user management section (admin only) |

---

### Task 1: Add userModel methods for password change and user listing

**Files:**
- Modify: `packages/server/src/db/index.ts`

- [ ] **Step 1: Add findAll and updatePassword methods to userModel**

```typescript
// Add to userModel object in packages/server/src/db/index.ts

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
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/db/index.ts
git commit -m "feat(server): add userModel.findAll and updatePassword methods"
```

---

### Task 2: Add changePassword to authService

**Files:**
- Modify: `packages/server/src/services/auth.ts`

- [ ] **Step 1: Add changePassword method to authService**

```typescript
// Add to authService object in packages/server/src/services/auth.ts

  // 修改密码
  async changePassword(username: string, oldPassword: string, newPassword: string) {
    const user = userModel.findByUsername(username);
    if (!user) {
      throw new Error('用户不存在');
    }

    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) {
      throw new Error('旧密码错误');
    }

    if (newPassword.length < 6) {
      throw new Error('密码至少6个字符');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    userModel.updatePassword(username, passwordHash);
    return true;
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/services/auth.ts
git commit -m "feat(server): add authService.changePassword method"
```

---

### Task 3: Add change-password endpoint and tests

**Files:**
- Modify: `packages/server/src/routes/auth.ts`
- Modify: `packages/server/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing test for change-password endpoint**

Add to `packages/server/src/__tests__/auth.test.ts`:

```typescript
  describe('POST /api/auth/change-password', () => {
    it('should change password with valid old password', async () => {
      const fastify = await buildServer();

      // Register user
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'changepwd', password: 'oldpass123' },
      });

      // Change password
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { username: 'changepwd', oldPassword: 'oldpass123', newPassword: 'newpass123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify can login with new password
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'changepwd', password: 'newpass123' },
      });
      expect(loginResponse.statusCode).toBe(200);
    });

    it('should reject wrong old password', async () => {
      const fastify = await buildServer();

      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'changepwd2', password: 'oldpass123' },
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { username: 'changepwd2', oldPassword: 'wrongpass', newPassword: 'newpass123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('旧密码错误');
    });

    it('should reject short new password', async () => {
      const fastify = await buildServer();

      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'changepwd3', password: 'oldpass123' },
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { username: 'changepwd3', oldPassword: 'oldpass123', newPassword: 'short' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('密码至少6个字符');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: Tests fail with change-password endpoint returning 404

- [ ] **Step 3: Add change-password endpoint to auth.ts routes**

Add to `packages/server/src/routes/auth.ts`:

```typescript
  // 修改密码
  fastify.post('/api/auth/change-password', async (request, reply) => {
    const { username, oldPassword, newPassword } = request.body as {
      username: string;
      oldPassword: string;
      newPassword: string;
    };

    if (!username || !oldPassword || !newPassword) {
      return reply.status(400).send({ error: '所有字段必填' });
    }

    try {
      await authService.changePassword(username, oldPassword, newPassword);
      return { success: true };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/auth.ts packages/server/src/__tests__/auth.test.ts
git commit -m "feat(server): add POST /api/auth/change-password endpoint"
```

---

### Task 4: Create admin routes file

**Files:**
- Create: `packages/server/src/routes/admin.ts`

- [ ] **Step 1: Create admin routes file**

Create `packages/server/src/routes/admin.ts`:

```typescript
import { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.js';
import { userModel } from '../db/index.js';

// Admin middleware - only allow 'admin' user
async function adminOnly(request: any, reply: any) {
  try {
    await request.jwtVerify();
    if (request.user.username !== 'admin') {
      return reply.status(403).send({ error: '无权限' });
    }
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function adminRoutes(fastify: FastifyInstance) {
  // Get all users
  fastify.get('/api/admin/users', {
    preHandler: adminOnly
  }, async (request, reply) => {
    const users = userModel.findAll();
    return {
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        createdAt: u.created_at,
      })),
    };
  });

  // Create user
  fastify.post('/api/admin/users', {
    preHandler: adminOnly
  }, async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };

    if (!username || !password) {
      return reply.status(400).send({ error: '用户名和密码必填' });
    }

    if (password.length < 6) {
      return reply.status(400).send({ error: '密码至少6个字符' });
    }

    try {
      const user = await authService.register(username, password);
      return { success: true, userId: user.id };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Reset password
  fastify.post('/api/admin/reset-password', {
    preHandler: adminOnly
  }, async (request, reply) => {
    const { username } = request.body as { username: string };

    if (!username) {
      return reply.status(400).send({ error: '用户名必填' });
    }

    const user = userModel.findByUsername(username);
    if (!user) {
      return reply.status(400).send({ error: '用户不存在' });
    }

    // Reset password to username
    const { bcrypt } = await import('bcryptjs');
    const SALT_ROUNDS = 10;
    const passwordHash = await bcrypt.hash(username, SALT_ROUNDS);
    userModel.updatePassword(username, passwordHash);

    return { success: true };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/routes/admin.ts
git commit -m "feat(server): add admin routes (users list, create, reset password)"
```

---

### Task 5: Register admin routes and add tests

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing tests for admin endpoints**

Add to `packages/server/src/__tests__/auth.test.ts`:

```typescript
import { adminRoutes } from '../routes/admin.js';

// Update buildServer to include admin routes
async function buildServer() {
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: '*' });
  await fastify.register(jwt, { secret: 'test-secret-key-for-testing' });
  await fastify.register(authRoutes);
  await fastify.register(adminRoutes);
  return fastify;
}

// Add new test section:
  describe('Admin endpoints', () => {
    it('should allow admin to list users', async () => {
      const fastify = await buildServer();

      // Create admin user directly
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'admin', password: 'admin123' },
      });

      // Login as admin
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Get users
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.users).toBeDefined();
      expect(body.users.length).toBeGreaterThan(0);
    });

    it('should reject non-admin from admin endpoints', async () => {
      const fastify = await buildServer();

      // Create non-admin user
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'normaluser', password: 'user123456' },
      });

      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'normaluser', password: 'user123456' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin to create user', async () => {
      const fastify = await buildServer();

      // Create and login as admin
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'admin', password: 'admin123' },
      });
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Create user
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { username: 'newuser', password: 'newpass123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.userId).toBeDefined();
    });

    it('should allow admin to reset password', async () => {
      const fastify = await buildServer();

      // Create admin and a test user
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'admin', password: 'admin123' },
      });
      await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'resetuser', password: 'oldpass123' },
      });

      // Login as admin
      const loginResponse = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Reset password
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/admin/reset-password',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { username: 'resetuser' },
      });

      expect(response.statusCode).toBe(200);

      // Verify can login with username as password
      const resetLogin = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'resetuser', password: 'resetuser' },
      });
      expect(resetLogin.statusCode).toBe(200);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: Tests fail with admin routes not registered

- [ ] **Step 3: Register admin routes in index.ts**

Add to `packages/server/src/index.ts`:

```typescript
import { adminRoutes } from './routes/admin.js';

// In the async function, after authRoutes registration:
  await fastify.register(adminRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/__tests__/auth.test.ts
git commit -m "feat(server): register admin routes and add tests"
```

---

### Task 6: Add changePassword to auth store

**Files:**
- Modify: `packages/web/src/stores/auth.ts`

- [ ] **Step 1: Add changePassword function to auth store**

Add to the return statement in `packages/web/src/stores/auth.ts`:

```typescript
  async function changePassword(username: string, oldPassword: string, newPassword: string, apiUrl: string) {
    const response = await fetch(`${apiUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, oldPassword, newPassword }),
    });
    const data = await response.json();
    if (data.success) {
      return true;
    }
    throw new Error(data.error || '修改密码失败');
  }

  return {
    accessToken,
    refreshToken,
    userId,
    username,
    isAuthenticated,
    setTokens,
    clearTokens,
    login,
    refresh,
    checkAndInitSession,
    updateLastActivity,
    changePassword,
  };
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/stores/auth.ts
git commit -m "feat(web): add changePassword function to auth store"
```

---

### Task 7: Add change-password form to LoginView

**Files:**
- Modify: `packages/web/src/views/LoginView.vue`

- [ ] **Step 1: Update LoginView with change-password form toggle**

Replace entire file content with:

```vue
<template>
  <div class="login-container">
    <div class="login-card">
      <h1>remoteCli</h1>
      <p>远程 PowerShell 终端</p>

      <!-- Login Form -->
      <form v-if="!showChangePassword" @submit.prevent="handleLogin">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="username" type="text" required autocomplete="username" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" type="password" required autocomplete="current-password" />
        </div>
        <button type="submit" :disabled="loading">{{ loading ? '登录中...' : '登录' }}</button>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="success">{{ success }}</p>
        <a href="#" class="toggle-link" @click.prevent="showChangePassword = true">修改密码</a>
      </form>

      <!-- Change Password Form -->
      <form v-else @submit.prevent="handleChangePassword">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="cpUsername" type="text" required autocomplete="username" />
        </div>
        <div class="form-group">
          <label>旧密码</label>
          <input v-model="cpOldPassword" type="password" required autocomplete="current-password" />
        </div>
        <div class="form-group">
          <label>新密码</label>
          <input v-model="cpNewPassword" type="password" required autocomplete="new-password" />
        </div>
        <button type="submit" :disabled="loading">{{ loading ? '处理中...' : '修改密码' }}</button>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="success">{{ success }}</p>
        <a href="#" class="toggle-link" @click.prevent="resetForms">返回登录</a>
      </form>

      <router-link to="/settings" class="settings-link">设置</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

// Login form
const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const success = ref('');

// Change password form
const showChangePassword = ref(false);
const cpUsername = ref('');
const cpOldPassword = ref('');
const cpNewPassword = ref('');

function resetForms() {
  showChangePassword.value = false;
  error.value = '';
  success.value = '';
  cpUsername.value = '';
  cpOldPassword.value = '';
  cpNewPassword.value = '';
}

async function handleLogin() {
  loading.value = true;
  error.value = '';
  success.value = '';
  try {
    await authStore.login(username.value, password.value, settingsStore.settings.apiUrl);
    router.push('/terminal');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function handleChangePassword() {
  loading.value = true;
  error.value = '';
  success.value = '';
  try {
    await authStore.changePassword(
      cpUsername.value,
      cpOldPassword.value,
      cpNewPassword.value,
      settingsStore.settings.apiUrl
    );
    success.value = '密码修改成功';
    cpOldPassword.value = '';
    cpNewPassword.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a2e; }
.login-card { background: #16213e; padding: 2rem; border-radius: 8px; width: 100%; max-width: 400px; }
.login-card h1 { color: #e94560; margin-bottom: 0.5rem; }
.login-card p { color: #a0a0a0; margin-bottom: 1.5rem; }
.form-group { margin-bottom: 1rem; }
.form-group label { display: block; color: #e0e0e0; margin-bottom: 0.5rem; }
.form-group input { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 4px; background: #1a1a2e; color: #fff; }
button { width: 100%; padding: 0.75rem; background: #e94560; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
button:disabled { opacity: 0.6; }
.error { color: #e94560; margin-top: 1rem; }
.success { color: #4caf50; margin-top: 1rem; }
.settings-link { display: block; text-align: center; margin-top: 1rem; color: #a0a0a0; }
.toggle-link { display: block; text-align: center; margin-top: 1rem; color: #a0a0a0; font-size: 0.9rem; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/views/LoginView.vue
git commit -m "feat(web): add change-password form toggle to LoginView"
```

---

### Task 8: Add user management to SettingsView

**Files:**
- Modify: `packages/web/src/views/SettingsView.vue`

- [ ] **Step 1: Update SettingsView with admin user management section**

Replace entire file content with:

```vue
<template>
  <div class="settings-container">
    <div class="settings-card">
      <h1>设置</h1>
      <div class="form-group">
        <label>API 地址</label>
        <input v-model="settings.apiUrl" type="text" />
      </div>
      <div class="form-group">
        <label>主题</label>
        <select v-model="settings.theme">
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </div>
      <div class="form-group">
        <label>字体</label>
        <input v-model="settings.fontFamily" type="text" />
      </div>
      <div class="form-group">
        <label>字号</label>
        <input v-model.number="settings.fontSize" type="number" min="10" max="24" />
      </div>
      <button @click="resetSettings">重置默认</button>

      <!-- Admin User Management Section -->
      <div v-if="isAdmin" class="admin-section">
        <h2>用户管理</h2>

        <!-- Reset Password -->
        <div class="form-group">
          <label>重置用户密码</label>
          <select v-model="selectedUser">
            <option value="">选择用户</option>
            <option v-for="user in users" :key="user.id" :value="user.username">
              {{ user.username }}
            </option>
          </select>
        </div>
        <button @click="handleResetPassword" :disabled="!selectedUser || loading">
          {{ loading ? '处理中...' : '重置密码' }}
        </button>
        <p v-if="resetMessage" :class="resetError ? 'error' : 'success'">{{ resetMessage }}</p>

        <!-- Create User -->
        <h3 style="margin-top: 1.5rem;">创建用户</h3>
        <div class="form-group">
          <label>用户名</label>
          <input v-model="newUsername" type="text" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="newPassword" type="password" />
        </div>
        <button @click="handleCreateUser" :disabled="!newUsername || !newPassword || loading">
          {{ loading ? '处理中...' : '创建用户' }}
        </button>
        <p v-if="createMessage" :class="createError ? 'error' : 'success'">{{ createMessage }}</p>
      </div>

      <router-link to="/login" class="back-link">返回登录</router-link>
      <router-link v-if="isAuthenticated" to="/terminal" class="back-link" style="margin-left: 1rem;">返回终端</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';

const { settings, resetSettings } = useSettingsStore();
const authStore = useAuthStore();

const isAdmin = computed(() => authStore.username === 'admin');
const isAuthenticated = computed(() => authStore.isAuthenticated);

// User management state
const users = ref<{ id: number; username: string }[]>([]);
const selectedUser = ref('');
const loading = ref(false);
const resetMessage = ref('');
const resetError = ref(false);
const newUsername = ref('');
const newPassword = ref('');
const createMessage = ref('');
const createError = ref(false);

async function fetchUsers() {
  if (!isAdmin.value || !authStore.accessToken) return;

  try {
    const response = await fetch(`${settings.value.apiUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
    const data = await response.json();
    if (data.users) {
      users.value = data.users;
    }
  } catch (e) {
    console.error('Failed to fetch users:', e);
  }
}

async function handleResetPassword() {
  if (!selectedUser.value || !authStore.accessToken) return;

  loading.value = true;
  resetMessage.value = '';
  resetError.value = false;

  try {
    const response = await fetch(`${settings.value.apiUrl}/api/admin/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ username: selectedUser.value }),
    });
    const data = await response.json();
    if (data.success) {
      resetMessage.value = `密码已重置为用户名: ${selectedUser.value}`;
    } else {
      resetError.value = true;
      resetMessage.value = data.error || '重置失败';
    }
  } catch (e) {
    resetError.value = true;
    resetMessage.value = '网络错误';
  } finally {
    loading.value = false;
  }
}

async function handleCreateUser() {
  if (!newUsername.value || !newPassword.value || !authStore.accessToken) return;

  loading.value = true;
  createMessage.value = '';
  createError.value = false;

  try {
    const response = await fetch(`${settings.value.apiUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ username: newUsername.value, password: newPassword.value }),
    });
    const data = await response.json();
    if (data.success) {
      createMessage.value = '用户创建成功';
      newUsername.value = '';
      newPassword.value = '';
      await fetchUsers(); // Refresh user list
    } else {
      createError.value = true;
      createMessage.value = data.error || '创建失败';
    }
  } catch (e) {
    createError.value = true;
    createMessage.value = '网络错误';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchUsers();
});
</script>

<style scoped>
.settings-container { display: flex; justify-content: center; padding: 2rem; background: #1a1a2e; min-height: 100vh; }
.settings-card { background: #16213e; padding: 2rem; border-radius: 8px; width: 100%; max-width: 500px; }
.settings-card h1 { color: #e94560; margin-bottom: 1.5rem; }
.form-group { margin-bottom: 1rem; }
.form-group label { display: block; color: #e0e0e0; margin-bottom: 0.5rem; }
.form-group input, .form-group select { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 4px; background: #1a1a2e; color: #fff; }
button { padding: 0.75rem 1.5rem; background: #e94560; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
button:disabled { opacity: 0.6; }
.back-link { display: inline-block; text-align: center; margin-top: 1rem; color: #a0a0a0; }
.admin-section { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #333; }
.admin-section h2 { color: #e94560; margin-bottom: 1rem; font-size: 1.2rem; }
.admin-section h3 { color: #e0e0e0; margin-bottom: 0.5rem; font-size: 1rem; }
.error { color: #e94560; margin-top: 0.5rem; font-size: 0.9rem; }
.success { color: #4caf50; margin-top: 0.5rem; font-size: 0.9rem; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/views/SettingsView.vue
git commit -m "feat(web): add admin user management section to SettingsView"
```

---

### Task 9: Final verification and build

- [ ] **Step 1: Run all server tests**

Run: `cd packages/server && pnpm test`
Expected: All tests pass

- [ ] **Step 2: Type check web package**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Build all packages**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git status
# If any uncommitted changes:
git add -A
git commit -m "fix: resolve build issues"
```

---

## Summary

- **Backend:** 4 new endpoints (change-password, admin users list/create/reset)
- **Frontend:** Change-password form toggle on LoginView, user management on SettingsView
- **No database changes required**
- **TDD approach:** Tests written before implementation for new endpoints