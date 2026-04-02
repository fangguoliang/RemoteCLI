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
  sessionId: string;      // Terminal session ID for routing
  requestId: string;      // Unique request ID for response matching
  url: string;            // Target URL (e.g., http://localhost:3000/api/data)
  method: string;         // HTTP method (GET, POST, PUT, DELETE)
  headers?: Record<string, string>;  // Request headers
  body?: string;          // Request body (base64 encoded, for POST/PUT)
}
```

#### http:response (Agent → Server)

```typescript
interface HttpResponsePayload {
  sessionId: string;      // Session ID
  requestId: string;      // Request ID for matching
  status: number;         // HTTP status code (200, 404, 500, etc.)
  headers: Record<string, string>;  // Response headers
  body: string;           // Response body (base64 encoded)
  error?: string;         // Error message if request failed
}
```

### Proxy URL Format

```
http://server:8080/proxy/{sessionId}/{originalUrl}

Example:
Original URL: http://localhost:3000/api/users
Proxy URL: http://server:8080/proxy/sess-123/http://localhost:3000/api/users
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

// Handle all proxy requests
proxyApp.all('/proxy/:sessionId/*', async (request, reply) => {
  const sessionId = request.params.sessionId;
  const targetPath = request.params['*'];  // Original URL path

  // Find corresponding Agent
  const agentWs = tunnelManager.getAgentForSession(sessionId);
  if (!agentWs) {
    reply.code(502).send({ error: 'Agent not connected' });
    return;
  }

  // Generate request ID
  const requestId = crypto.randomUUID();

  // Construct request message
  const httpRequest: Message = {
    type: 'http:request',
    sessionId,
    payload: {
      sessionId,
      requestId,
      url: targetPath,
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.body ? btoa(request.body) : undefined,
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
    reply.code(response.status);
    reply.headers(response.headers);
    reply.send(atob(response.body));
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
```

## Agent HTTP Request Execution

### HTTP Handler Module

```typescript
// packages/agent/src/httpHandler.ts

import http from 'http';
import { WebSocket } from 'ws';

export async function handleHttpRequest(ws: WebSocket, message: Message) {
  const payload = message.payload as HttpRequestPayload;
  const { sessionId, requestId, url, method, headers, body } = payload;

  // Parse target URL (usually localhost)
  const targetUrl = new URL(url);

  try {
    // Execute HTTP request
    const response = await executeHttpRequest({
      hostname: targetUrl.hostname,
      port: parseInt(targetUrl.port) || 80,
      path: targetUrl.pathname + targetUrl.search,
      method,
      headers: headers || {},
      body: body ? Buffer.from(body, 'base64') : undefined,
    });

    // Construct response message
    const httpResponse: Message = {
      type: 'http:response',
      sessionId,
      payload: {
        sessionId,
        requestId,
        status: response.status,
        headers: response.headers,
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
        sessionId,
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
}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 200,
          headers: res.headers as Record<string, string>,
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
    console.warn('No session ID, cannot open URL');
    return;
  }

  // Set WebViewer state
  const fileStore = useFileStore();
  fileStore.setWebViewerUrl(url);
  fileStore.setWebViewerSessionId(sessionId);
  fileStore.setWebViewerVisible(true);
}
```

### File Store Extensions

```typescript
// packages/web/src/stores/file.ts

// New WebViewer related state
const webViewerUrl = ref<string | null>(null);       // Target URL
const webViewerSessionId = ref<string | null>(null); // Session ID (for proxy routing)
const webViewerState = ref<'closed' | 'fullscreen' | 'minimized'>('closed');
const webViewerViewport = ref<'mobile' | 'tablet' | 'desktop'>('mobile');

// Proxy URL calculation
const webViewerProxyUrl = computed(() => {
  if (!webViewerUrl.value || !webViewerSessionId.value) return null;

  // Construct proxy URL
  const serverHost = config.serverHost;  // Server address
  const proxyPort = config.proxyPort;    // HTTP proxy port (8080)

  return `http://${serverHost}:${proxyPort}/proxy/${webViewerSessionId.value}/${webViewerUrl.value}`;
});

// New methods
function setWebViewerUrl(url: string | null) {
  webViewerUrl.value = url;
}

function setWebViewerSessionId(sid: string | null) {
  webViewerSessionId.value = sid;
}

function setWebViewerVisible(visible: boolean) {
  webViewerState.value = visible ? 'fullscreen' : 'closed';
}

function clearWebViewer() {
  webViewerUrl.value = null;
  webViewerSessionId.value = null;
  webViewerState.value = 'closed';
  webViewerViewport.value = 'mobile';
}
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
| shared | `src/types.ts` | Modify | Add `http:request`, `http:response` message types and `HttpRequestPayload`, `HttpResponsePayload` interfaces |
| server | `src/proxy/httpProxy.ts` | Create | HTTP proxy service (port 8080), receives iframe requests and forwards to Agent |
| server | `src/ws/router.ts` | Modify | Add `http:request`, `http:response` message routing |
| server | `src/index.ts` | Modify | Start HTTP proxy service |
| agent | `src/httpHandler.ts` | Create | HTTP request execution module, executes localhost HTTP requests |
| agent | `src/tunnel.ts` | Modify | Add `http:request` message handling |
| web | `src/components/WebViewer.vue` | Create | Website preview component (landscape/portrait layouts, minimize, viewport switch) |
| web | `src/components/TerminalTab.vue` | Modify | Add localhost URL LinkProvider detection |
| web | `src/stores/file.ts` | Modify | Add `webViewerUrl`, `webViewerSessionId`, `webViewerState` state |
| web | `src/config.ts` | Create (if not exists) | Add `proxyPort` config |

## Implementation Order

1. **shared/types.ts** - Add `http:request`, `http:response` message types and payload interfaces
2. **server/src/proxy/httpProxy.ts** - Create HTTP proxy service
3. **server/src/ws/router.ts** - Add message routing switch cases
4. **server/src/index.ts** - Start HTTP proxy service
5. **agent/src/httpHandler.ts** - Create HTTP request execution module
6. **agent/src/tunnel.ts** - Add http:request message handling
7. **web/src/config.ts** - Add proxyPort config
8. **web/src/stores/file.ts** - Add WebViewer state and methods
9. **web/src/components/WebViewer.vue** - Create component
10. **web/src/components/TerminalTab.vue** - Add URL LinkProvider and integration

## Out of Scope

- Remote server URLs (not localhost)
- HTTPS proxy (only HTTP for now)
- WebSocket connections inside iframe
- Multiple concurrent viewers
- Bookmark/favorite URLs
- URL history