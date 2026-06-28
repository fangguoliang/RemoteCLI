<template>
  <router-view />
  <VoiceFloatingBar v-if="authStore.isAuthenticated" />
  <!-- Blackbox reproduction button -->
  <button
    v-if="showBlackboxButton"
    class="blackbox-repro-btn"
    @click="reportReproduction"
    title="点击报告问题复现"
  >
    🔴 复现了
  </button>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import VoiceFloatingBar from './components/VoiceFloatingBar.vue';
import { useAuthStore } from './stores/auth';
import { useTerminalStore } from './stores/terminal';
import { initAppVoiceConnection, isVoiceWebSocketReady } from './services/voiceWebSocket';
import { blackbox } from './utils/eventLogger';

const authStore = useAuthStore();
const terminalStore = useTerminalStore();

// Blackbox reproduction button
const showBlackboxButton = ref(true);

async function reportReproduction() {
  console.log('[App] User reported bug reproduction');
  blackbox.log('user', 'reproduction:reported', {
    timestamp: Date.now(),
    route: window.location.pathname,
  });

  await blackbox.captureSnapshot(`bug-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`);

  const data = {
    events: blackbox.recent(100),
    startTime: (blackbox as any).startTime,
    label: `bug-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`,
  };

  // Upload to server
  try {
    const response = await fetch('/api/blackbox/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    alert(`✅ 已上报！Report ID: ${result.id}\n事件数: ${result.eventCount}`);
    blackbox.clear();
  } catch (err) {
    // Fallback: show in alert
    const json = JSON.stringify(data, null, 2);
    alert(`上报失败: ${err}\n\n数据:\n${json.slice(0, 2000)}...`);
  }
}

// 记录上次成功连接的 agentId，避免重复创建
let lastConnectedAgentId: string | null = null;
let initialSetupDone = false;

function setupVoiceConnection(forceReconnect = false) {
  if (!authStore.userId) return;

  // 找到一个在线的 agent（用于语音命令路由到 agent）
  const onlineAgent = terminalStore.agents.find(a => a.online);
  const agentId = onlineAgent?.agentId || null;

  // 如果连接已经存在且 agentId 没变，跳过
  if (!forceReconnect && isVoiceWebSocketReady() && agentId === lastConnectedAgentId) {
    return;
  }

  // 如果已经有连接但 agentId 变了（agent切换），才重新连接
  // 或者还没有连接，创建新连接
  if (forceReconnect || !isVoiceWebSocketReady() || !initialSetupDone || agentId !== lastConnectedAgentId) {
    console.log('[App] Setting up voice connection, userId:', authStore.userId, 'agentId:', agentId);
    initAppVoiceConnection(authStore.userId.toString(), agentId || undefined);
    lastConnectedAgentId = agentId;
    initialSetupDone = true;
  }
}

onMounted(() => {
  // 初始连接（可能没有 agent）
  setupVoiceConnection();

  // 1秒后再检查一次，确保有 agent 可用
  setTimeout(() => setupVoiceConnection(), 1000);

  // === DEBUG: 全局事件监控 ===

  // 1. 监控 document 级别的 touch 事件
  let lastTouchX = 0;
  let lastTouchY = 0;
  let lastTouchTarget: HTMLElement | null = null;

  // [debug-blackbox] Capture touchstart at document level to track ALL touches
  // Use non-passive to allow preventDefault on edge touches
  document.addEventListener('touchstart', (e) => {
    const target = (e.target as HTMLElement);
    lastTouchTarget = target;
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;

    const isMdToolbar = !!target?.closest('.md-editor-toolbar, .md-b-toolbar, .md-editor-toolbar-wrapper, .md-editor-toolbar-item');
    const isMdEditor = !!target?.closest('.md-editor, .md-editor-preview-wrap, .md-editor-preview');
    const isFileOverlay = !!target?.closest('.file-overlay, .overlay-content');

    blackbox.log('global-touch', 'document:touchstart', {
      x: lastTouchX,
      y: lastTouchY,
      target: (target?.className || 'unknown').toString().slice(0, 50),
      isMdToolbar,
      isMdEditor,
      isFileOverlay,
    });

    // [debug-blackbox] Block edge touches to prevent browser swipe navigation
    // BUT: Never preventDefault on interactive elements — it blocks synthesized click events
    const tag = target?.tagName?.toLowerCase() || '';
    const isDirectlyInteractive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea'
      || !!target?.closest('[role="button"], .dropdown-btn, .nav-btn, .action-btn, .icon-btn, .back-btn, .save-btn, .edit-btn, .path-segment');
    if (!isDirectlyInteractive) {
      const screenWidth = window.innerWidth;
      const isLeftEdge = lastTouchX < 50;
      const isRightEdge = lastTouchX > screenWidth - 50;
      if (isLeftEdge || isRightEdge) {
        e.preventDefault();
        blackbox.log('global-touch', 'document:touchstart-edge-blocked', {
          x: lastTouchX,
          y: lastTouchY,
          screenWidth,
          isLeftEdge,
          isRightEdge,
        });
      }
    }
  }, { passive: false, capture: true });

  // [debug-blackbox] Block horizontal swipe to prevent browser back/forward navigation
  // Use capture phase to intercept BEFORE any component handlers
  // CRITICAL: Never preventDefault on interactive elements — it blocks synthesized click events
  document.addEventListener('touchmove', (e) => {
    const dx = Math.abs(e.touches[0].clientX - lastTouchX);
    const dy = Math.abs(e.touches[0].clientY - lastTouchY);
    // Check if target is DIRECTLY an interactive element (button/link itself, not content inside scrollable areas)
    // Use element.tagName for exact match — closest() would match <a> inside scrollable md preview, which is wrong
    const target = lastTouchTarget;
    const tag = target?.tagName?.toLowerCase() || '';
    const isDirectlyInteractive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea'
      || !!target?.closest('[role="button"], .dropdown-btn, .nav-btn, .action-btn, .icon-btn, .back-btn, .save-btn, .edit-btn, .path-segment');
    if (dx > dy && dx > 10 && !isDirectlyInteractive) {
      e.preventDefault();
      blackbox.log('global-touch', 'document:touchmove-blocked', {
        dx, dy,
        prevented: true,
        target: (target?.className || 'unknown').toString().slice(0, 50),
      });
    } else if (dx > 30) {
      blackbox.log('global-touch', 'document:touchmove-horizontal', {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        dx, dy,
        isDirectlyInteractive,
      });
    }
  }, { passive: false, capture: true });

  // [debug-blackbox] Monitor touchend events
  document.addEventListener('touchend', (e) => {
    blackbox.log('global-touch', 'document:touchend', {
      changedTouches: e.changedTouches.length,
      x: e.changedTouches[0]?.clientX,
      y: e.changedTouches[0]?.clientY,
      target: (lastTouchTarget?.className || 'unknown').toString().slice(0, 50),
    });
  }, { passive: true, capture: true });

  // 2. 监控 popstate 事件（history.back/forward）
  window.addEventListener('popstate', (e) => {
    blackbox.log('history', 'popstate', {
      state: e.state,
      url: window.location.href,
      pathname: window.location.pathname,
    });
  });

  // 3. 监控 hashchange
  window.addEventListener('hashchange', (e) => {
    blackbox.log('history', 'hashchange', {
      oldUrl: e.oldURL,
      newUrl: e.newURL,
    });
  });

  // 4. 监控 beforeunload（完整页面卸载）
  window.addEventListener('beforeunload', () => {
    blackbox.log('navigation', 'beforeunload', {
      url: window.location.href,
      pathname: window.location.pathname,
    });
    // sendBeacon 确保数据发送
    try {
      navigator.sendBeacon('/api/blackbox/report', JSON.stringify({
        events: blackbox.recent(20),
        label: 'beforeunload',
      }));
    } catch { /* ignore */ }
  });

  // 5. 定期检查 touch-action 计算样式
  setTimeout(() => {
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const bodyStyle = window.getComputedStyle(document.body);
    blackbox.log('css', 'touch-action-check', {
      htmlTouchAction: htmlStyle.touchAction,
      bodyTouchAction: bodyStyle.touchAction,
      htmlOverscrollX: htmlStyle.overscrollBehaviorX,
      bodyOverscrollX: bodyStyle.overscrollBehaviorX,
    });
  }, 1000);

  // 6. 监控可见性变化（判断是否页面切换）
  document.addEventListener('visibilitychange', () => {
    blackbox.log('navigation', 'visibilitychange', {
      hidden: document.hidden,
      url: window.location.href,
    });
  });
});

// 只在 agents 首次上线时重新连接，不要每次 agents 列表变化都重连
watch(() => terminalStore.agents, (newAgents, oldAgents) => {
  if (!authStore.userId) return;

  const hadOnlineAgent = oldAgents?.some(a => a.online) || false;
  const hasOnlineAgent = newAgents.some(a => a.online);

  // 只有从"无在线agent"变成"有在线agent"时才重连
  if (!hadOnlineAgent && hasOnlineAgent) {
    setupVoiceConnection(true);
  }
}, { deep: true });

onUnmounted(() => {
  // Cleanup happens when app unloads
});
</script>

<style>
/* Disable pull-to-refresh and swipe navigation globally */
html, body {
  overscroll-behavior-y: contain;
  overscroll-behavior-x: none; /* prevent browser back/forward swipe */
  touch-action: pan-y; /* only allow vertical panning at browser level */
}

/* Blackbox reproduction button - hidden for production */
.blackbox-repro-btn {
  position: fixed;
  bottom: 80px;
  right: 20px;
  z-index: 99999;
  background: #ff4444;
  color: white;
  border: none;
  border-radius: 50px;
  padding: 12px 20px;
  font-size: 16px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(255, 68, 68, 0.4);
  display: none; /* Hidden for production */
}
</style>
