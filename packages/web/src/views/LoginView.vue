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
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--bg-page);
  padding: var(--space-4);
}

.login-card {
  background: var(--bg-surface);
  padding: var(--space-8) var(--space-6);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 400px;
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
}

.login-card h1 {
  color: var(--accent);
  margin-bottom: var(--space-1);
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  text-shadow: var(--text-shadow-glow);
}

.login-card p {
  color: var(--text-secondary);
  margin-bottom: var(--space-6);
  font-size: 0.95rem;
}

.form-group {
  margin-bottom: var(--space-4);
}

.form-group label {
  display: block;
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
  font-weight: 500;
  font-size: 0.875rem;
}

.form-group input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-root);
  color: var(--text-primary);
  font-size: 1rem;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

button {
  width: 100%;
  padding: 0.75rem;
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
  transition: background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

button:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: var(--shadow-glow);
}

button:active:not(:disabled) {
  transform: scale(0.98);
}

.error {
  color: var(--error);
  margin-top: var(--space-4);
  font-size: 0.9rem;
}

.success {
  color: var(--success);
  margin-top: var(--space-4);
  font-size: 0.9rem;
}

.settings-link {
  display: block;
  text-align: center;
  margin-top: var(--space-6);
  color: var(--text-secondary);
  transition: color var(--transition-fast);
}

.settings-link:hover {
  color: var(--accent);
}

.toggle-link {
  display: block;
  text-align: center;
  margin-top: var(--space-4);
  color: var(--text-secondary);
  font-size: 0.9rem;
  transition: color var(--transition-fast);
}

.toggle-link:hover {
  color: var(--accent);
}
</style>