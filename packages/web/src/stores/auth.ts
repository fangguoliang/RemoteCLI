import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// Session timeout in milliseconds (30 minutes)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'ccremote-last-activity';

export const useAuthStore = defineStore('auth', () => {
  // 从 sessionStorage 读取初始值
  const accessToken = ref<string | null>(sessionStorage.getItem('accessToken'));
  const refreshToken = ref<string | null>(sessionStorage.getItem('refreshToken'));
  const userId = ref<number | null>(null);
  const username = ref<string | null>(null);

  // 页面加载时从 sessionStorage 恢复 userId 和 username
  const storedUserId = sessionStorage.getItem('userId');
  const storedUsername = sessionStorage.getItem('username');
  if (storedUserId) userId.value = parseInt(storedUserId, 10);
  if (storedUsername) username.value = storedUsername;

  const isAuthenticated = computed(() => !!accessToken.value);

  // Check if session has expired
  function isSessionExpired(): boolean {
    const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!lastActivity) return true;

    const elapsed = Date.now() - parseInt(lastActivity, 10);
    return elapsed > SESSION_TIMEOUT_MS;
  }

  // Update last activity timestamp
  function updateLastActivity() {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }

  // Check session on page load and setup activity tracking
  function checkAndInitSession(): boolean {
    if (!accessToken.value) return false;

    // Check if session expired
    if (isSessionExpired()) {
      console.log('Session expired, clearing tokens');
      clearTokens();
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      return false;
    }

    // Update activity timestamp
    updateLastActivity();
    return true;
  }

  function setTokens(access: string, refresh: string, uid?: number, user?: string) {
    accessToken.value = access;
    refreshToken.value = refresh;
    if (uid !== undefined) {
      userId.value = uid;
      sessionStorage.setItem('userId', uid.toString());
    }
    if (user !== undefined) {
      username.value = user;
      sessionStorage.setItem('username', user);
    }
    sessionStorage.setItem('accessToken', access);
    sessionStorage.setItem('refreshToken', refresh);
    updateLastActivity();
  }

  function clearTokens() {
    accessToken.value = null;
    refreshToken.value = null;
    userId.value = null;
    username.value = null;
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('username');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  }

  async function login(user: string, pass: string, apiUrl: string) {
    const response = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await response.json();
    if (data.success) {
      setTokens(data.accessToken, data.refreshToken, data.userId, data.username);
      return true;
    }
    throw new Error(data.error || 'Login failed');
  }

  async function refresh(apiUrl: string) {
    if (!refreshToken.value || !userId.value) return false;
    try {
      const response = await fetch(`${apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken.value, userId: userId.value }),
      });
      const data = await response.json();
      if (data.success) {
        setTokens(data.accessToken, data.refreshToken);
        return true;
      }
    } catch {}
    clearTokens();
    return false;
  }

  return { accessToken, refreshToken, userId, username, isAuthenticated, setTokens, clearTokens, login, refresh, checkAndInitSession, updateLastActivity };
});