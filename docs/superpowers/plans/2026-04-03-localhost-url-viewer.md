# Localhost URL Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable mobile users to click localhost URLs in terminal output and preview local development websites through an HTTP proxy tunneled via WebSocket.

**Architecture:** HTTP proxy server on port 8080 receives iframe requests, routes to Agent via WebSocket, Agent executes HTTP request to localhost and returns response. WebViewer component displays preview with viewport switching (mobile/tablet/desktop), landscape fullscreen, and minimize/restore functionality.

**Tech Stack:** Fastify (HTTP proxy), WebSocket (tunneling), Vue 3 + Pinia (WebViewer), xterm.js LinkProvider (URL detection)

---

## File Structure

| Package | File | Action | Responsibility |
|---------|------|--------|----------------|
| shared | `src/types.ts` | Modify | Add http:request/http:response message types |
| server | `src/ws/tunnel.ts` | Modify | Add getAgentWebSocketForSession() for proxy routing |
| server | `src/proxy/httpProxy.ts` | Create | HTTP proxy service (port 8080) |
| server | `src/ws/router.ts` | Modify | Add http:response message routing |
| server | `src/index.ts` | Modify | Start HTTP proxy service |
| agent | `src/httpHandler.ts` | Create | Execute localhost HTTP requests |
| agent | `src/tunnel.ts` | Modify | Add http:request message handler |
| web | `src/stores/webViewer.ts` | Create | WebViewer state management |
| web | `src/components/WebViewer.vue` | Create | Preview component with viewport controls |
| web | `src/components/TerminalTab.vue` | Modify | Add localhost URL LinkProvider |

---

### Task 1: Add HTTP Message Types to Shared Package

**Files:**
- Modify: `packages/shared/src/types.ts:4-26`

- [ ] **Step 1: Add message types to MessageType enum**

Edit `packages/shared/src/types.ts` to add `http:request` and `http:response` to the MessageType enum:

```typescript
// packages/shared/src/types.ts

// WebSocket 消息类型
export type MessageType =
  | 'auth'
  | 'auth:result'
  | 'register'
  | 'register:result'
  | 'session:create'
  | 'session:start'
  | 'session:input'
  | 'session:output'
  | 'session:resize'
  | 'session:close'
  | 'ping'
  | 'pong'
  | 'file:browse'
  | 'file:list'
  | 'file:upload'
  | 'file:progress'
  | 'file:uploaded'
  | 'file:download'
  | 'file:data'
  | 'file:error'
  | 'file:validate'
  | 'file:validated'
  | 'http:request'      // NEW: HTTP proxy request
  | 'http:response';    // NEW: HTTP proxy response
```

- [ ] **Step 2: Add HttpRequestPayload interface**

Add after the existing payload interfaces (around line 150):

```typescript
// HTTP Proxy 相关类型
export interface HttpRequestPayload {
  requestId: string;      // Unique request ID for response matching
  url: string;            // Target URL (e.g., http://localhost:3000/api/data)
  method: string;         // HTTP method (GET, POST, PUT, DELETE)
  headers?: Record<string, string | string[]>;  // Request headers (supports multi-value)
  body?: string;          // Request body (base64 encoded, for POST/PUT)
}

export interface HttpResponsePayload {
  requestId: string;      // Request ID for matching
  status: number;         // HTTP status code (200, 404, 500, etc.)
  headers: Record<string, string | string[]>;  // Response headers (supports multi-value like Set-Cookie)
  body: string;           // Response body (base64 encoded)
  error?: string;         // Error message if request failed
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/shared && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add http:request and http:response message types for HTTP proxy"
```

---

### Task 2: Add getAgentWebSocketForSession to TunnelManager

**Files:**
- Modify: `packages/server/src/ws/tunnel.ts:245-250`

- [ ] **Step 1: Add getAgentWebSocketForSession method**

Add method to TunnelManager class in `packages/server/src/ws/tunnel.ts` before the closing brace (around line 248):

```typescript
  // Get Agent WebSocket for a specific session (used by HTTP proxy)
  getAgentWebSocketForSession(sessionId: string): WebSocket | null {
    // Find agentId for this session
    const agentId = this.sessionAgents.get(sessionId);
    if (!agentId) return null;

    // Find agent WebSocket
    return this.agents.get(agentId)?.ws || null;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws/tunnel.ts
git commit -m "feat(server): add getAgentWebSocketForSession method for HTTP proxy routing"
```

---

### Task 3: Create HTTP Proxy Service

**Files:**
- Create: `packages/server/src/proxy/httpProxy.ts`
- Create: `packages/server/src/proxy/index.ts`

- [ ] **Step 1: Create proxy directory**

Run: `mkdir -p packages/server/src/proxy`

- [ ] **Step 2: Create httpProxy.ts**

Create `packages/server/src/proxy/httpProxy.ts`:

```typescript
// packages/server/src/proxy/httpProxy.ts

import Fastify from 'fastify';
import { tunnelManager } from '../ws/tunnel.js';
import type { Message, HttpResponsePayload } from '@remotecli/shared';

const proxyApp = Fastify({ logger: true });

// Configure raw body parser for binary data support (file uploads, POST with binary)
proxyApp.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body) => body);

// Store pending requests waiting for Agent response
const pendingRequests = new Map<string, {
  resolve: (response: HttpResponsePayload) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

// Handle all proxy requests - use wildcard to capture encoded URL
proxyApp.all('/proxy/:sessionId/*', async (request, reply) => {
  const sessionId = request.params.sessionId;
  const encodedUrl = request.params['*'];  // Wildcard captures the rest of the path

  // Decode the target URL
  const targetUrl = decodeURIComponent(encodedUrl);

  // Find corresponding Agent via TunnelManager
  const agentWs = tunnelManager.getAgentWebSocketForSession(sessionId);
  if (!agentWs) {
    reply.code(502).send({ error: 'Agent not connected' });
    return;
  }

  // Generate request ID
  const requestId = crypto.randomUUID();

  // Convert headers to array format for multi-value support
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers[key] = value;
    }
  }

  // Construct request message (sessionId at message level, not payload)
  const httpRequest: Message = {
    type: 'http:request',
    sessionId,
    payload: {
      requestId,
      url: targetUrl,
      method: request.method,
      headers,
      body: request.body ? (request.body as Buffer).toString('base64') : undefined,
    },
    timestamp: Date.now(),
  };

  // Create Promise to wait for response
  const responsePromise = new Promise<HttpResponsePayload>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout: setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000),  // 30s timeout
    });
  });

  // Send request to Agent
  agentWs.send(JSON.stringify(httpRequest));

  // Wait for response
  try {
    const response = await responsePromise;

    // Convert headers back to flat format for HTTP response
    const flatHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      flatHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    reply.code(response.status);
    reply.headers(flatHeaders);

    // Handle binary response properly
    const bodyBuffer = Buffer.from(response.body, 'base64');
    reply.send(bodyBuffer);
  } catch (err) {
    const error = err as Error;
    reply.code(502).send({ error: error.message });
  }
});

// Handle Agent response
export function handleHttpResponse(message: Message) {
  const payload = message.payload as HttpResponsePayload;
  const pending = pendingRequests.get(payload.requestId);

  if (pending) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(payload.requestId);

    if (payload.error) {
      pending.reject(new Error(payload.error));
    } else {
      pending.resolve(payload);
    }
  }
}

// Start the proxy server
export async function startProxyServer(port: number = 8080) {
  try {
    await proxyApp.listen({ port, host: '0.0.0.0' });
    console.log(`HTTP Proxy server running on port ${port}`);
    return proxyApp;
  } catch (err) {
    proxyApp.log.error(err);
    throw err;
  }
}

export { proxyApp };
```

- [ ] **Step 3: Create index.ts for exports**

Create `packages/server/src/proxy/index.ts`:

```typescript
// packages/server/src/proxy/index.ts

export { proxyApp, startProxyServer, handleHttpResponse } from './httpProxy.js';
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/proxy/
git commit -m "feat(server): create HTTP proxy service for localhost URL tunneling"
```

---

### Task 4: Add HTTP Response Routing to Router

**Files:**
- Modify: `packages/server/src/ws/router.ts:172-178`

- [ ] **Step 1: Import handleHttpResponse**

Add import at the top of `packages/server/src/ws/router.ts`:

```typescript
import { handleHttpResponse } from '../proxy/index.js';
```

- [ ] **Step 2: Add http:response case to switch statement**

Add case in the switch statement (before the `default` case):

```typescript
    case 'http:response':
      // Agent returns HTTP response, route to proxy handler
      handleHttpResponse(message);
      break;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws/router.ts
git commit -m "feat(server): add http:response routing to WebSocket router"
```

---

### Task 5: Start HTTP Proxy in Server Index

**Files:**
- Modify: `packages/server/src/index.ts:1-40`

- [ ] **Step 1: Import proxy server**

Add import at the top of `packages/server/src/index.ts`:

```typescript
import { startProxyServer } from './proxy/index.js';
```

- [ ] **Step 2: Start proxy server after main server starts**

Modify the `start` function to start the proxy server after the main server:

```typescript
const start = async () => {
  try {
    // Initialize database
    await initDatabase();

    await fastify.listen({ port: config.port, host: '0.0.0.0' });

    // Setup WebSocket after server is ready
    setupWebSocket(fastify);

    // Start HTTP proxy server for localhost URL viewer
    await startProxyServer(8080);

    console.log(`Server running on port ${config.port}`);
    console.log(`WebSocket endpoints: ws://localhost:${config.port}/ws/browser, ws://localhost:${config.port}/ws/agent`);
    console.log(`HTTP Proxy: http://localhost:8080/proxy/:sessionId/:encodedUrl`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/server && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): start HTTP proxy server on port 8080"
```

---

### Task 6: Create HTTP Handler in Agent

**Files:**
- Create: `packages/agent/src/httpHandler.ts`

- [ ] **Step 1: Create httpHandler.ts**

Create `packages/agent/src/httpHandler.ts`:

```typescript
// packages/agent/src/httpHandler.ts

import http from 'http';
import { WebSocket } from 'ws';
import type { Message, HttpRequestPayload } from '@remotecli/shared';

export async function handleHttpRequest(ws: WebSocket, message: Message) {
  const payload = message.payload as HttpRequestPayload;
  const sessionId = message.sessionId;
  const { requestId, url, method, headers, body } = payload;

  // Parse target URL (usually localhost)
  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    // Invalid URL
    ws.send(JSON.stringify({
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: 400,
        headers: {},
        body: '',
        error: 'Invalid URL',
      },
      timestamp: Date.now(),
    }));
    return;
  }

  // Convert headers to flat format for http.request
  const flatHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    flatHeaders[key] = Array.isArray(value) ? value[0] : value;
  }

  try {
    // Execute HTTP request
    const response = await executeHttpRequest({
      hostname: targetUrl.hostname,
      port: parseInt(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method,
      headers: flatHeaders,
      body: body ? Buffer.from(body, 'base64') : undefined,
    });

    // Convert response headers to array format for multi-value support
    const responseHeaders: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      responseHeaders[key] = value;
    }

    // Construct response message
    ws.send(JSON.stringify({
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: response.status,
        headers: responseHeaders,
        body: response.body.toString('base64'),
      },
      timestamp: Date.now(),
    }));
  } catch (err) {
    const error = err as Error;
    // Error response
    ws.send(JSON.stringify({
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: 502,
        headers: {},
        body: '',
        error: error.message,
      },
      timestamp: Date.now(),
    }));
  }
}

// Execute HTTP request using Node.js http module
async function executeHttpRequest(options: {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 200,
          headers: res.headers as Record<string, string | string[]>,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/agent && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/httpHandler.ts
git commit -m "feat(agent): create HTTP request handler for localhost proxy"
```

---

### Task 7: Add HTTP Request Handling to Agent Tunnel

**Files:**
- Modify: `packages/agent/src/tunnel.ts:80-138`

- [ ] **Step 1: Import handleHttpRequest**

Add import at the top of `packages/agent/src/tunnel.ts`:

```typescript
import { handleHttpRequest } from './httpHandler.js';
```

- [ ] **Step 2: Add http:request case to switch statement**

Add case in the `handleMessage` switch statement (after `file:validate` case):

```typescript
        case 'http:request':
          handleHttpRequest(this.ws!, message);
          break;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/agent && pnpm build`
Expected: Build succeeds without errors

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/tunnel.ts
git commit -m "feat(agent): add http:request handler to tunnel message routing"
```

---

### Task 8: Create WebViewer Store

**Files:**
- Create: `packages/web/src/stores/webViewer.ts`

- [ ] **Step 1: Create webViewer.ts store**

Create `packages/web/src/stores/webViewer.ts`:

```typescript
// packages/web/src/stores/webViewer.ts

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSettingsStore } from './settings';

export type ViewerState = 'closed' | 'fullscreen' | 'minimized';
export type ViewportType = 'mobile' | 'tablet' | 'desktop';

export interface ViewportSize {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

const VIEWPORTS: Record<ViewportType, ViewportSize> = {
  mobile: { width: 375, height: 667, orientation: 'portrait' },
  tablet: { width: 768, height: 1024, orientation: 'landscape' },
  desktop: { width: 1920, height: 1080, orientation: 'landscape' },
};

const PROXY_PORT = 8080;

export const useWebViewerStore = defineStore('webViewer', () => {
  // State
  const url = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const state = ref<ViewerState>('closed');
  const viewport = ref<ViewportType>('mobile');

  // Get server host from settings
  const settings = useSettingsStore();

  const serverHost = computed(() => {
    const apiUrl = settings.settings.apiUrl || '';
    // Derive host from apiUrl: "https://server.com/api" -> "server.com"
    const match = apiUrl.match(/^https?:\/\/([^:/]+)/);
    return match ? match[1] : window.location.hostname;
  });

  // Proxy URL calculation (URL-encoded)
  const proxyUrl = computed(() => {
    if (!url.value || !sessionId.value) return null;

    const encodedUrl = encodeURIComponent(url.value);
    return `http://${serverHost.value}:${PROXY_PORT}/proxy/${sessionId.value}/${encodedUrl}`;
  });

  // Check if current viewport is landscape
  const isLandscape = computed(() => {
    return VIEWPORTS[viewport.value].orientation === 'landscape';
  });

  // Get current viewport dimensions
  const currentViewportSize = computed(() => {
    return VIEWPORTS[viewport.value];
  });

  // Methods
  function setUrl(targetUrl: string | null) {
    url.value = targetUrl;
  }

  function setSessionId(sid: string | null) {
    sessionId.value = sid;
  }

  function setVisible(visible: boolean) {
    state.value = visible ? 'fullscreen' : 'closed';
  }

  function setMinimized() {
    state.value = 'minimized';
  }

  function setViewport(v: ViewportType) {
    viewport.value = v;
  }

  function clear() {
    url.value = null;
    sessionId.value = null;
    state.value = 'closed';
    viewport.value = 'mobile';
  }

  return {
    url,
    sessionId,
    state,
    viewport,
    proxyUrl,
    isLandscape,
    currentViewportSize,
    VIEWPORTS,
    setUrl,
    setSessionId,
    setVisible,
    setMinimized,
    setViewport,
    clear,
  };
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/webViewer.ts
git commit -m "feat(web): create WebViewer store for localhost URL preview state"
```

---

### Task 9: Create WebViewer Component

**Files:**
- Create: `packages/web/src/components/WebViewer.vue`

- [ ] **Step 1: Create WebViewer.vue**

Create `packages/web/src/components/WebViewer.vue`:

```vue
<template>
  <!-- Fullscreen viewer -->
  <div
    v-if="webViewerStore.state === 'fullscreen'"
    class="web-viewer fullscreen"
    :class="{ landscape: webViewerStore.isLandscape }"
  >
    <!-- Portrait layout: header top, controls bottom -->
    <template v-if="!webViewerStore.isLandscape">
      <div class="viewer-header">
        <button class="btn-minimize" @click="minimize">—</button>
        <span class="viewer-title">{{ displayUrl }}</span>
        <button class="btn-close" @click="close">×</button>
      </div>
      <div class="viewer-content">
        <iframe
          ref="iframeRef"
          :src="webViewerStore.proxyUrl"
          :style="iframeStyle"
          frameborder="0"
          allowfullscreen
        ></iframe>
      </div>
      <div class="viewer-controls">
        <button
          :class="{ active: webViewerStore.viewport === 'mobile' }"
          @click="setViewport('mobile')"
        >📱 手机</button>
        <button
          :class="{ active: webViewerStore.viewport === 'tablet' }"
          @click="setViewport('tablet')"
        >📋 平板</button>
        <button
          :class="{ active: webViewerStore.viewport === 'desktop' }"
          @click="setViewport('desktop')"
        >🖥 桌面</button>
      </div>
    </template>

    <!-- Landscape layout: controls on right side -->
    <template v-else>
      <div class="viewer-content landscape-content">
        <iframe
          ref="iframeRef"
          :src="webViewerStore.proxyUrl"
          :style="iframeStyle"
          frameborder="0"
          allowfullscreen
        ></iframe>
      </div>
      <div class="viewer-controls landscape-controls">
        <button class="btn-minimize" @click="minimize">—</button>
        <button
          :class="{ active: webViewerStore.viewport === 'mobile' }"
          @click="setViewport('mobile')"
        >📱</button>
        <button
          :class="{ active: webViewerStore.viewport === 'tablet' }"
          @click="setViewport('tablet')"
        >📋</button>
        <button
          :class="{ active: webViewerStore.viewport === 'desktop' }"
          @click="setViewport('desktop')"
        >🖥</button>
        <button class="btn-close" @click="close">×</button>
      </div>
    </template>
  </div>

  <!-- Minimized floating bar -->
  <div
    v-if="webViewerStore.state === 'minimized'"
    class="web-viewer minimized-bar"
  >
    <span class="minimized-title">🌐 {{ displayUrl }}</span>
    <button class="btn-restore" @click="restore">恢复</button>
    <button class="btn-close-minimized" @click="close">×</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWebViewerStore, type ViewportType } from '../stores/webViewer';

const webViewerStore = useWebViewerStore();
const iframeRef = ref<HTMLIFrameElement | null>(null);

// Display URL (truncate if too long)
const displayUrl = computed(() => {
  const url = webViewerStore.url || '';
  return url.length > 30 ? url.substring(0, 30) + '...' : url;
});

// iframe style for scaling in landscape mode
const iframeStyle = computed(() => {
  if (!webViewerStore.isLandscape) {
    // Portrait: actual size display (fit to container)
    return {
      width: '100%',
      height: '100%',
    };
  }

  // Landscape: scaled to fit screen
  const viewport = webViewerStore.currentViewportSize;
  const controlBarWidth = 48;
  const screenWidth = window.innerWidth - controlBarWidth;
  const screenHeight = window.innerHeight;

  // Calculate scale ratio
  const scaleX = screenWidth / viewport.width;
  const scaleY = screenHeight / viewport.height;
  const scale = Math.min(scaleX, scaleY);

  return {
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  };
});

// Viewport switching with fullscreen control
async function setViewport(viewport: ViewportType) {
  webViewerStore.setViewport(viewport);

  if (webViewerStore.VIEWPORTS[viewport].orientation === 'landscape') {
    await enterFullscreenLandscape();
  } else {
    await exitFullscreen();
  }
}

// Enter landscape fullscreen mode
async function enterFullscreenLandscape() {
  try {
    await document.documentElement.requestFullscreen();
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch {
    // Browser doesn't support, ignore
  }
}

// Exit fullscreen mode
async function exitFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  if (screen.orientation?.unlock) {
    screen.orientation.unlock();
  }
}

// Minimize (preserve iframe)
function minimize() {
  webViewerStore.setMinimized();
  exitFullscreen();
}

// Restore from minimized state
async function restore() {
  webViewerStore.setVisible(true);
  if (webViewerStore.isLandscape) {
    await enterFullscreenLandscape();
  }
}

// Close (release resources)
async function close() {
  await exitFullscreen();
  webViewerStore.clear();
}

// Watch for fullscreen changes
watch(() => webViewerStore.state, (newState, oldState) => {
  if (newState === 'fullscreen' && oldState !== 'minimized') {
    // Just opened - enter fullscreen if landscape
    if (webViewerStore.isLandscape) {
      enterFullscreenLandscape();
    }
  }
});
</script>

<style scoped>
.web-viewer {
  position: fixed;
  background: #1a1a2e;
  z-index: 1000;
}

/* Fullscreen mode */
.web-viewer.fullscreen {
  inset: 0;
  display: flex;
}

.web-viewer.fullscreen:not(.landscape) {
  flex-direction: column;
}

.web-viewer.fullscreen.landscape {
  flex-direction: row;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #16213e;
  color: #e0e0e0;
  height: 48px;
}

.viewer-title {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.landscape-content {
  flex: 1;
  overflow: auto;
  background: #0f0f23;
}

.viewer-content iframe {
  border: none;
  background: white;
}

.viewer-controls {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: #16213e;
}

.viewer-controls:not(.landscape-controls) {
  justify-content: center;
  height: 56px;
}

.landscape-controls {
  flex-direction: column;
  width: 48px;
  padding: 12px 8px;
  align-items: center;
  gap: 12px;
}

.viewer-controls button {
  background: #1a1a2e;
  border: 1px solid #4a4a6a;
  color: #e0e0e0;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.landscape-controls button {
  padding: 8px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-controls button.active {
  background: #e94560;
  border-color: #e94560;
}

.viewer-controls button:hover {
  background: #2a2a4e;
}

.btn-close, .btn-minimize {
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 20px;
  padding: 4px 8px;
  cursor: pointer;
}

.landscape-controls .btn-close {
  margin-top: auto;
}

.landscape-controls .btn-minimize {
  margin-bottom: 8px;
}

/* Minimized bar */
.minimized-bar {
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #16213e;
  border-top: 1px solid #4a4a6a;
  color: #e0e0e0;
}

.minimized-title {
  font-size: 14px;
}

.btn-restore {
  background: #e94560;
  border: none;
  color: white;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-close-minimized {
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 18px;
  cursor: pointer;
}
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/WebViewer.vue
git commit -m "feat(web): create WebViewer component with viewport switching and minimize"
```

---

### Task 10: Add Localhost URL LinkProvider to TerminalTab

**Files:**
- Modify: `packages/web/src/components/TerminalTab.vue:1-8`
- Modify: `packages/web/src/components/TerminalTab.vue:319-540`

- [ ] **Step 1: Import WebViewer store and component**

Add imports at the top of the script section in `packages/web/src/components/TerminalTab.vue`:

```typescript
import { useWebViewerStore } from '../stores/webViewer';
import WebViewer from './WebViewer.vue';
```

- [ ] **Step 2: Add WebViewer component to template**

Modify the template to include WebViewer:

```vue
<template>
  <div class="terminal-wrapper" v-show="visible">
    <div ref="terminalRef" class="terminal"></div>
    <div v-if="status === 'connecting'" class="status-overlay">连接中...</div>
    <div v-if="status === 'disconnected'" class="status-overlay error">已断开</div>
    <MarkdownViewer />
    <WebViewer />
  </div>
</template>
```

- [ ] **Step 3: Initialize WebViewer store**

Add store reference after other store initializations:

```typescript
const webViewerStore = useWebViewerStore();
```

- [ ] **Step 4: Add localhost URL detection to LinkProvider**

Inside the `provideLinks` callback (after the existing .md detection logic), add localhost URL detection:

```typescript
        // Localhost URL detection
        const urlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1)(?:\:\d+)?(?:[\/\?#][^\s]*)?/g;
        let urlMatch;

        while ((urlMatch = urlRegex.exec(lineText)) !== null) {
          const matchedUrl = urlMatch[0];
          const matchStart = urlMatch.index;
          const matchEnd = matchStart + matchedUrl.length;

          foundLinks.push({
            range: {
              start: { x: matchStart + 1, y: bufferLineNumber },
              end: { x: matchEnd, y: bufferLineNumber },
            },
            text: matchedUrl,
            decorations: {
              underline: true,
              pointerCursor: true,
            },
            activate(_event: MouseEvent, _text: string) {
              handleLocalhostUrlClick(matchedUrl);
            },
          });
        }
```

- [ ] **Step 5: Add URL click handler**

Add function after `handleMdPathClick`:

```typescript
// Handle localhost URL click
function handleLocalhostUrlClick(url: string) {
  console.log('[TerminalTab] handleLocalhostUrlClick:', url, 'sessionId:', sessionId);

  if (!sessionId) {
    console.log('[TerminalTab] no sessionId, cannot open WebViewer');
    // Could show toast here if needed
    return;
  }

  // Set WebViewer state
  webViewerStore.setUrl(url);
  webViewerStore.setSessionId(sessionId);
  webViewerStore.setVisible(true);
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/TerminalTab.vue
git commit -m "feat(web): add localhost URL LinkProvider and WebViewer integration"
```

---

## Testing Checklist

After implementation, manually test:

- [ ] Click localhost:3000 URL in terminal → WebViewer opens
- [ ] iframe loads website content
- [ ] Switch to tablet viewport → landscape fullscreen
- [ ] Switch to desktop viewport → landscape fullscreen maintained
- [ ] Switch to mobile viewport → exit fullscreen, portrait
- [ ] Minimize → bottom bar appears, iframe preserved
- [ ] Restore → viewer expands (no reload)
- [ ] Close → viewer closes completely
- [ ] Terminal operable while minimized
- [ ] URL with path (localhost:3000/api) works
- [ ] URL with query (localhost:3000?foo=bar) works

---

## Known Limitations

1. WebSocket inside iframe cannot be proxied (HMR may not work)
2. HTTPS localhost not supported
3. Relative URL navigation in iframe may not work
4. iOS Safari fullscreen limited
5. Large binary files may have performance issues