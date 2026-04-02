# Localhost URL Viewer Design Spec

**Date**: 2026-04-02
**Author**: fangguoliang

## Overview

Add a feature to RemoteCLI that allows users to click on localhost URLs in terminal output to open a web preview viewer. This enables front-end developers to preview their local development websites on mobile devices without being physically near their computer. The viewer supports viewport switching (mobile/tablet/desktop) with landscape fullscreen mode for wide screens, and a minimize function to preserve page state while interacting with the terminal.

## Requirements

### User Story

When developing web applications remotely through RemoteCLI on a mobile device, developers need:
1. Click localhost URLs (e.g., `http://localhost:3000`) in terminal output
2. Preview the website in a fullscreen viewer on mobile
3. Switch between viewport sizes (mobile/tablet/desktop) to verify responsive design
4. Use landscape mode with fullscreen to maximize screen space for wide viewport simulation
5. Minimize the viewer to check terminal output while keeping the page state alive
6. Close the viewer when done to release resources

### Key Requirements

- Detect localhost URLs in terminal output (localhost and 127.0.0.1)
- Click to open fullscreen web preview viewer
- Support three viewport presets: mobile (375x667), tablet (768x1024), desktop (1920x1080)
- Landscape fullscreen mode for tablet/desktop viewports
- Minimize function preserves iframe DOM (page state not lost)
- Close function releases resources completely
- HTTP proxy tunneling through existing WebSocket connection

## Architecture

### Flow Diagram

```
Terminal Output → LinkProvider detects localhost URL → User clicks →
WebViewer opens (fullscreen) → iframe loads proxy URL →
Server HTTP Proxy receives request → forwards to Agent via WebSocket →
Agent executes HTTP request to localhost → returns response →
Server HTTP Proxy returns response to iframe → Website renders

Viewport Switch:
User selects tablet/desktop → auto enter landscape fullscreen →
iframe scaled via CSS transform to fit screen

Minimize:
Click minimize button → viewer shrinks to bottom floating bar →
iframe DOM preserved (hidden) → terminal operable →
Click restore → viewer expands back (no reload)

Close:
Click close button → viewer closes → iframe destroyed → resources released
```

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Mobile Browser (packages/web)                    │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────────┐   │
│  │ TerminalTab   │───→│ URL LinkClick │───→│ WebViewer Popup   │   │
│  │ (显示URL)     │    │ Handler       │    │ (iframe预览)      │   │
│  └───────────────┘    └───────────────┘    └───────────────────┘   │
│                              │                      │              │
│                              │ WebSocket            │ iframe src   │
│                              ↓                      ↓              │
└──────────────────────────────│──────────────────────│──────────────┘
                               │                      │
┌──────────────────────────────│──────────────────────│──────────────┐
│              Linux Cloud Server (packages/server)                   │
│                              │                      │              │
│  ┌───────────────┐           │    ┌───────────────┐ │              │
│  │ WebSocket     │←──────────┘    │ HTTP Proxy    │←┘              │
│  │ Router        │                │ Server (:8080)│                │
│  └───────────────┘                └───────────────┘                │
│         │                                   │                      │
│         │ WebSocket forward                 │ HTTP request forward │
│         ↓                                   ↓                      │
└─────────────────────────────────────────────────────────────────────┘
         │                                   │
┌────────│───────────────────────────────────│────────────────────────┐
│                   Windows Agent (packages/agent)                     │
│         │                                   │                      │
│  ┌───────────────┐                ┌───────────────┐                 │
│  │ TunnelHandler │←───────────────│ LocalHttpFetch│                 │
│  │ (消息路由)    │                │ (执行HTTP请求) │                 │
│  └───────────────┘                └───────────────┘                 │
│                                          │                         │
│                                          ↓                         │
│                               ┌───────────────────┐                 │
│                               │ localhost:3000    │                 │
│                               │ (开发服务器)      │                 │
│                               └───────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Technical Details

### Message Types

#### http:request (Server → Agent)

```typescript
interface HttpRequestPayload {
  requestId: string;      // Unique request ID for response matching
  url: string;            // Target URL (e.g., http://localhost:3000/api/data)
  method: string;         // HTTP method (GET, POST, PUT, DELETE)
  headers?: Record<string, string | string[]>;  // Request headers (supports multi-value)
  body?: string;          // Request body (base64 encoded, for POST/PUT)
}
// Note: sessionId is at the Message level, not in payload (avoids duplication)
```

#### http:response (Agent → Server)

```typescript
interface HttpResponsePayload {
  requestId: string;      // Request ID for matching
  status: number;         // HTTP status code (200, 404, 500, etc.)
  headers: Record<string, string | string[]>;  // Response headers (supports multi-value like Set-Cookie)
  body: string;           // Response body (base64 encoded)
  error?: string;         // Error message if request failed
}
// Note: sessionId is at the Message level, not in payload (avoids duplication)
```

### Proxy URL Format

**Note**: The original URL is URL-encoded to avoid parsing issues with embedded `://` characters.

```
http://server:8080/proxy/{sessionId}/{encodedUrl}

Example:
Original URL: http://localhost:3000/api/users
Encoded URL: http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fusers
Proxy URL: http://server:8080/proxy/sess-123/http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fusers
```

**Implementation**:
```typescript
// Encode the original URL before constructing proxy URL
const encodedUrl = encodeURIComponent(originalUrl);
const proxyUrl = `http://${serverHost}:${proxyPort}/proxy/${sessionId}/${encodedUrl}`;

// Decode in proxy handler
const targetUrl = decodeURIComponent(request.params['*']);
```

### URL Detection Regex

```typescript
// Match localhost URLs, excluding .md file paths (handled separately)
const localhostUrlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1)(?:\:\d+)?(?:[\/\?#][^\s]*)?/g;

// Test cases:
// http://localhost:3000          → matches
// http://localhost:3000/api      → matches
// https://127.0.0.1:8080         → matches
// http://localhost               → matches (default port 80)
// https://localhost:5173/about   → matches
// http://192.168.1.1:3000        → not matched (not localhost)
```

### Viewport Presets

```typescript
const VIEWPORTS = {
  mobile: { width: 375, height: 667, orientation: 'portrait' },
  tablet: { width: 768, height: 1024, orientation: 'landscape' },
  desktop: { width: 1920, height: 1080, orientation: 'landscape' },
};
```

### WebViewer Component Layout

#### Portrait Mode (Mobile Viewport)

```
┌─────────────────────────────────────┐
│ [—] 最小化    localhost:3000    [✕] │  Header (close at top-right)
├─────────────────────────────────────┤
│                                     │
│         iframe 预览区域             │  Content area (maximized)
│         (actual size display)       │
│                                     │
│                                     │
├─────────────────────────────────────┤
│      [📱手机] [📋平板] [🖥桌面]       │  Bottom viewport switch bar
└─────────────────────────────────────┘
```

#### Landscape Mode (Tablet/Desktop Viewport) - Right-side Control Bar

```
┌─────────────────────────────────────────────────────────────┬──┐
│                                                             │—│
│                                                             │最│
│                                                             │小│
│                                                             │化│
│                                                             │  │
│                                                             │📱│
│                                                             │手│
│                    iframe 预览区域                           │机│
│                 (占满左侧全部空间)                           │  │
│                                                             │📋│
│                                                             │平│
│                                                             │板│
│                                                             │  │
│                                                             │🖥│
│                                                             │桌│
│                                                             │面│
│                                                             │  │
│                                                             │✕│
│                                                             │关│
│                                                             │闭│
└─────────────────────────────────────────────────────────────┴──┘
```

**Right-side control bar button order (top to bottom):**
1. — Minimize (top, frequently used)
2. 📱 Mobile viewport
3. 📋 Tablet viewport
4. 🖥 Desktop viewport
5. ✕ Close (bottom, prevent accidental touch)

**Control bar width**: ~48px, icons only, compact arrangement

**iframe area**: From left edge to control bar, height 100vh

### CSS Transform Scaling for Landscape Mode

```typescript
// iframe scaling calculation
const iframeStyle = computed(() => {
  if (!isLandscape.value) return {};

  const viewport = VIEWPORTS[currentViewport.value];
  const screenWidth = window.innerWidth - 48;  // minus control bar width
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
```

### Fullscreen Mode Control

**Browser Restrictions Note**:
- Fullscreen API requires user gesture (click/touch) - cannot be activated programmatically on page load
- iOS Safari has limited fullscreen support - may fall back to just maximizing viewport size
- Screen orientation lock may not work on all browsers - user may need to manually rotate device
- If fullscreen fails, the viewer will still work in normal mode with viewport scaling

```typescript
// Enter landscape fullscreen mode
async function enterFullscreenLandscape() {
  try {
    await document.documentElement.requestFullscreen();
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) {
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

// Viewport switch
function setViewport(viewport: keyof VIEWPORTS) {
  currentViewport.value = viewport;

  if (VIEWPORTS[viewport].orientation === 'landscape') {
    enterFullscreenLandscape();
  } else {
    exitFullscreen();
  }
}

// Minimize (iframe DOM preserved, only hidden)
function minimize() {
  viewerState.value = 'minimized';
  exitFullscreen();
}

// Restore
function restore() {
  viewerState.value = 'fullscreen';
  if (isLandscape.value) {
    enterFullscreenLandscape();
  }
}

// Close (release resources)
function close() {
  viewerState.value = 'closed';
  exitFullscreen();
  store.clearWebViewer();
}
```

### Minimized State (Bottom Floating Bar)

```
┌─────────────────────────────────────┐
│                                     │
│     Terminal 正常显示               │
│                                     │
│                                     │
├─────────────────────────────────────┤
│  [🌐 localhost:3000]  [恢复] [关闭] │  Bottom floating bar
└─────────────────────────────────────┘
```

**Key implementation**: iframe DOM element is preserved when minimized, page state remains intact. Click restore to expand immediately without reloading.

## Server HTTP Proxy Implementation

### HTTP Proxy Service

```typescript
// packages/server/src/proxy/httpProxy.ts

import Fastify from 'fastify';
import { tunnelManager } from '../ws/tunnel';

const proxyApp = Fastify();
const pendingRequests = new Map<string, {
  resolve: (response: HttpResponsePayload) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

// Handle all proxy requests - URL is encoded in path
proxyApp.all('/proxy/:sessionId/:encodedUrl', async (request, reply) => {
  const sessionId = request.params.sessionId;
  const encodedUrl = request.params.encodedUrl;

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
    sessionId,  // At message level for routing
    payload: {
      requestId,
      url: targetUrl,
      method: request.method,
      headers,
      body: request.body ? Buffer.from(request.body as string).toString('base64') : undefined,
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
    reply.code(502).send({ error: err.message });
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

// TunnelManager needs new method - add to packages/server/src/ws/tunnel.ts
export function getAgentWebSocketForSession(sessionId: string): WebSocket | null {
  // Find agentId for this session
  const agentId = this.sessionAgents.get(sessionId);
  if (!agentId) return null;

  // Find agent WebSocket
  return this.agents.get(agentId)?.ws || null;
}
```

## Agent HTTP Request Execution

### HTTP Handler Module

```typescript
// packages/agent/src/httpHandler.ts

import http from 'http';
import { WebSocket } from 'ws';

export async function handleHttpRequest(ws: WebSocket, message: Message) {
  const payload = message.payload as HttpRequestPayload;
  const sessionId = message.sessionId;  // Get from message level, not payload
  const { requestId, url, method, headers, body } = payload;

  // Parse target URL (usually localhost)
  const targetUrl = new URL(url);

  // Convert headers to flat format for http.request
  const flatHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    flatHeaders[key] = Array.isArray(value) ? value[0] : value;
  }

  try {
    // Execute HTTP request
    const response = await executeHttpRequest({
      hostname: targetUrl.hostname,
      port: parseInt(targetUrl.port) || 80,
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

    // Construct response message (sessionId at message level)
    const httpResponse: Message = {
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: response.status,
        headers: responseHeaders,
        body: response.body.toString('base64'),
      },
      timestamp: Date.now(),
    };

    ws.send(JSON.stringify(httpResponse));
  } catch (err) {
    // Error response
    const errorResponse: Message = {
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: 502,
        headers: {},
        body: '',
        error: err.message,
      },
      timestamp: Date.now(),
    };

    ws.send(JSON.stringify(errorResponse));
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

### Integration to TunnelManager

```typescript
// packages/agent/src/tunnel.ts

// Add to message handling switch
case 'http:request':
  handleHttpRequest(ws, message);
  break;
```

## Frontend Integration

### TerminalTab LinkProvider

```typescript
// packages/web/src/components/TerminalTab.vue

// Add localhost URL detection to existing LinkProvider
terminal.registerLinkProvider({
  provideLinks(bufferLineNumber: number, callback: (links: any[] | undefined) => void) {
    // ... existing .md file detection code ...

    // New: localhost URL detection
    const lineText = line.translateToString(true);
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

    callback(foundLinks.length > 0 ? foundLinks : undefined);
  },
});

// URL click handler
function handleLocalhostUrlClick(url: string) {
  if (!sessionId) {
    // Show user-facing error instead of silent console.warn
    showToast('请先连接终端会话');
    return;
  }

  // Set WebViewer state
  const webViewerStore = useWebViewerStore();
  webViewerStore.setUrl(url);
  webViewerStore.setSessionId(sessionId);
  webViewerStore.setVisible(true);
}
```

### WebViewer Store (New Dedicated Store)

**Note**: Creating a dedicated store instead of extending file.ts to maintain semantic separation.

```typescript
// packages/web/src/stores/webViewer.ts

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSettingsStore } from './settings';

export const useWebViewerStore = defineStore('webViewer', () => {
  // State
  const url = ref<string | null>(null);       // Target URL
  const sessionId = ref<string | null>(null); // Session ID (for proxy routing)
  const state = ref<'closed' | 'fullscreen' | 'minimized'>('closed');
  const viewport = ref<'mobile' | 'tablet' | 'desktop'>('mobile');

  // Get server host from settings (derive from apiUrl)
  const settings = useSettingsStore();

  const serverHost = computed(() => {
    // Derive host from apiUrl: "https://server.com/api" -> "server.com"
    const apiUrl = settings.apiUrl || '';
    const match = apiUrl.match(/^https?:\/\/([^:/]+)/);
    return match ? match[1] : 'localhost';
  });

  const proxyPort = 8080;  // Fixed proxy port

  // Proxy URL calculation (URL-encoded)
  const proxyUrl = computed(() => {
    if (!url.value || !sessionId.value) return null;

    // Encode the URL to avoid parsing issues
    const encodedUrl = encodeURIComponent(url.value);

    return `http://${serverHost.value}:${proxyPort}/proxy/${sessionId.value}/${encodedUrl}`;
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

  function setViewport(v: 'mobile' | 'tablet' | 'desktop') {
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
    setUrl,
    setSessionId,
    setVisible,
    setMinimized,
    setViewport,
    clear,
  };
});
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Agent not connected | HTTP 502: "Agent not connected" |
| Request timeout (30s) | HTTP 502: "Request timeout" |
| Localhost service not running | HTTP 502: "Connection refused" |
| Invalid URL format | HTTP 400: "Invalid URL" |
| WebSocket disconnected | Toast: "连接已断开" |

## Testing Considerations

### Manual Testing Checklist

- [ ] Click localhost:3000 URL in terminal
- [ ] WebViewer opens in fullscreen
- [ ] iframe loads website content
- [ ] Switch to tablet viewport → enter landscape fullscreen
- [ ] Switch to desktop viewport → landscape fullscreen maintained
- [ ] Switch back to mobile viewport → exit fullscreen, portrait mode
- [ ] Minimize button → viewer shrinks to bottom bar
- [ ] Restore button → viewer expands back (no reload)
- [ ] Close button → viewer closes completely
- [ ] Terminal operable while viewer minimized
- [ ] URL with path (localhost:3000/api) works
- [ ] URL with query (localhost:3000?foo=bar) works

## File Changes Summary

| Package | File | Action | Description |
|---------|------|--------|-------------|
| shared | `src/types.ts` | Modify | Add `http:request`, `http:response` to MessageType enum; add `HttpRequestPayload`, `HttpResponsePayload` interfaces |
| server | `src/proxy/httpProxy.ts` | Create | HTTP proxy service (port 8080), receives iframe requests and forwards to Agent |
| server | `src/ws/tunnel.ts` | Modify | Add `getAgentWebSocketForSession()` method for proxy routing |
| server | `src/ws/router.ts` | Modify | Add `http:request`, `http:response` message routing |
| server | `src/index.ts` | Modify | Start HTTP proxy service |
| agent | `src/httpHandler.ts` | Create | HTTP request execution module, executes localhost HTTP requests |
| agent | `src/tunnel.ts` | Modify | Add `http:request` message handling |
| web | `src/components/WebViewer.vue` | Create | Website preview component (landscape/portrait layouts, minimize, viewport switch) |
| web | `src/components/TerminalTab.vue` | Modify | Add localhost URL LinkProvider detection and click handler |
| web | `src/stores/webViewer.ts` | Create | Dedicated WebViewer state store (separate from file.ts for semantic clarity) |

## Implementation Order

1. **shared/types.ts** - Add `http:request`, `http:response` to MessageType enum; add payload interfaces
2. **server/src/ws/tunnel.ts** - Add `getAgentWebSocketForSession()` method
3. **server/src/proxy/httpProxy.ts** - Create HTTP proxy service
4. **server/src/ws/router.ts** - Add message routing switch cases
5. **server/src/index.ts** - Start HTTP proxy service
6. **agent/src/httpHandler.ts** - Create HTTP request execution module
7. **agent/src/tunnel.ts** - Add http:request message handling
8. **web/src/stores/webViewer.ts** - Create dedicated WebViewer store
9. **web/src/components/WebViewer.vue** - Create component
10. **web/src/components/TerminalTab.vue** - Add URL LinkProvider and integration

## Known Limitations

1. **WebSocket inside iframe**: Many modern dev servers use WebSocket for HMR (Hot Module Replacement), live reload, and real-time features. These WebSocket connections cannot be proxied through the HTTP proxy. This is a known limitation - pages with WebSocket features may not work correctly.

2. **HTTPS localhost**: Only HTTP localhost URLs are supported. HTTPS localhost URLs (common with some frameworks) require certificate handling which is not implemented.

3. **Relative URLs in iframe**: If a user clicks a relative link inside the iframe, navigation may not work correctly. Only the initial URL is proxied.

4. **iOS Safari fullscreen**: Fullscreen API has limited support on iOS Safari. Landscape mode will work but may not fully hide browser UI.

5. **Binary file downloads**: Large binary files (images, videos) may have performance issues due to base64 encoding overhead.

## Out of Scope

- Remote server URLs (not localhost)
- Multiple concurrent viewers
- Bookmark/favorite URLs
- URL history
- Authentication/authorization on proxy endpoint (assumes internal service behind auth wall)