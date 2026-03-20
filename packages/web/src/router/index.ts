import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTerminalStore } from '../stores/terminal';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue'), meta: { requiresAuth: false } },
  { path: '/', redirect: '/terminal' },
  { path: '/terminal', name: 'Terminal', component: () => import('../views/TerminalView.vue'), meta: { requiresAuth: true } },
  { path: '/files', name: 'Files', component: () => import('../views/FileView.vue'), meta: { requiresAuth: true } },
  { path: '/settings', name: 'Settings', component: () => import('../views/SettingsView.vue'), meta: { requiresAuth: false } },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // Check session validity on protected routes
  if (to.meta.requiresAuth) {
    if (!authStore.checkAndInitSession()) {
      // Session expired or invalid, clear terminal state and redirect to login
      const terminalStore = useTerminalStore();
      terminalStore.clearCurrentSession();
      next('/login');
      return;
    }
  }

  if (to.path === '/login' && authStore.isAuthenticated) {
    next('/terminal');
  } else {
    next();
  }
});

export default router;