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

        <!-- User Selection -->
        <div class="form-group">
          <label>选择用户</label>
          <select v-model="selectedUser">
            <option value="">选择用户</option>
            <option v-for="user in users" :key="user.id" :value="user.username">
              {{ user.username }}
            </option>
          </select>
        </div>

        <!-- User Action Buttons -->
        <div class="button-group">
          <button @click="handleResetPassword" :disabled="!selectedUser || loading">
            重置密码
          </button>
          <button @click="handleDisableUser" :disabled="!selectedUser || loading" class="btn-warning">
            禁用
          </button>
          <button @click="handleDeleteUser" :disabled="!selectedUser || loading" class="btn-danger">
            删除
          </button>
        </div>
        <p v-if="actionMessage" :class="actionError ? 'error' : 'success'">{{ actionMessage }}</p>

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

      <router-link v-if="isAuthenticated" to="/terminal" class="back-link">返回终端</router-link>
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
const actionMessage = ref('');
const actionError = ref(false);
const newUsername = ref('');
const newPassword = ref('');
const createMessage = ref('');
const createError = ref(false);

async function fetchUsers() {
  if (!isAdmin.value || !authStore.accessToken) return;

  try {
    const response = await fetch(`${settings.apiUrl}/api/admin/users`, {
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
  actionMessage.value = '';
  actionError.value = false;

  try {
    const response = await fetch(`${settings.apiUrl}/api/admin/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ username: selectedUser.value }),
    });
    const data = await response.json();
    if (data.success) {
      actionMessage.value = `密码已重置为用户名: ${selectedUser.value}`;
    } else {
      actionError.value = true;
      actionMessage.value = data.error || '重置失败';
    }
  } catch (e) {
    actionError.value = true;
    actionMessage.value = '网络错误';
  } finally {
    loading.value = false;
  }
}

async function handleDisableUser() {
  if (!selectedUser.value || !authStore.accessToken) return;

  loading.value = true;
  actionMessage.value = '';
  actionError.value = false;

  try {
    const response = await fetch(`${settings.apiUrl}/api/admin/disable-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ username: selectedUser.value }),
    });
    const data = await response.json();
    if (data.success) {
      actionMessage.value = `用户 ${selectedUser.value} 已禁用`;
    } else {
      actionError.value = true;
      actionMessage.value = data.error || '禁用失败';
    }
  } catch (e) {
    actionError.value = true;
    actionMessage.value = '网络错误';
  } finally {
    loading.value = false;
  }
}

async function handleDeleteUser() {
  if (!selectedUser.value || !authStore.accessToken) return;

  if (!confirm(`确定要删除用户 "${selectedUser.value}" 吗？此操作不可恢复。`)) {
    return;
  }

  loading.value = true;
  actionMessage.value = '';
  actionError.value = false;

  try {
    const response = await fetch(`${settings.apiUrl}/api/admin/delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ username: selectedUser.value }),
    });
    const data = await response.json();
    if (data.success) {
      actionMessage.value = `用户 ${selectedUser.value} 已删除`;
      selectedUser.value = '';
      await fetchUsers(); // Refresh user list
    } else {
      actionError.value = true;
      actionMessage.value = data.error || '删除失败';
    }
  } catch (e) {
    actionError.value = true;
    actionMessage.value = '网络错误';
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
    const response = await fetch(`${settings.apiUrl}/api/admin/users`, {
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
.back-link { display: block; text-align: center; margin-top: 1rem; color: #a0a0a0; }
.admin-section { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #333; }
.admin-section h2 { color: #e94560; margin-bottom: 1rem; font-size: 1.2rem; }
.admin-section h3 { color: #e0e0e0; margin-bottom: 0.5rem; font-size: 1rem; }
.button-group { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.button-group button { flex: 1; }
.btn-warning { background: #ff9800; }
.btn-danger { background: #f44336; }
.error { color: #e94560; margin-top: 0.5rem; font-size: 0.9rem; }
.success { color: #4caf50; margin-top: 0.5rem; font-size: 0.9rem; }
</style>