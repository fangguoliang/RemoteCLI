// packages/agent/src/httpHandler.ts

import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import type { Message, HttpRequestPayload } from '@remotecli/shared';

// MIME types for common file extensions
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export async function handleHttpRequest(ws: WebSocket, message: Message, cwd?: string | null) {
  const payload = message.payload as HttpRequestPayload;
  const sessionId = message.sessionId;
  const { requestId, url, method, headers, body } = payload;

  // Check if this is a file:// URL (local HTML file)
  if (url.startsWith('file://')) {
    await handleFileRequest(ws, sessionId, requestId, url, cwd);
    return;
  }

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

// Handle file:// URL requests (local HTML files)
async function handleFileRequest(ws: WebSocket, sessionId: string | undefined, requestId: string, fileUrl: string, cwd?: string | null) {
  try {
    // Convert file:// URL to local path
    // file:///C:/path/to/file.html -> C:\path\to\file.html
    let localPath = fileUrl.replace('file:///', '');

    // Handle URL encoding (e.g., %20 for spaces)
    localPath = decodeURIComponent(localPath);

    // On Windows, convert forward slashes to backslashes
    if (process.platform === 'win32') {
      localPath = localPath.replace(/\//g, '\\');
    }

    // [debug-loop] fix: resolve relative paths using session CWD
    // When frontend CWD parsing fails (e.g. Claude Code TUI), the file URL
    // may contain only a relative path like file:///poster.html
    if (!localPath.match(/^[A-Za-z]:/)) {
      if (cwd) {
        localPath = path.resolve(cwd, localPath);
        console.log('[Agent] Resolved relative path using CWD:', localPath);
      } else {
        console.warn('[Agent] Relative path but no CWD available:', localPath);
      }
    }

    console.log('[Agent] handleFileRequest:', fileUrl, '->', localPath);

    // Check if file exists
    if (!fs.existsSync(localPath)) {
      ws.send(JSON.stringify({
        type: 'http:response',
        sessionId,
        payload: {
          requestId,
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
          body: Buffer.from('File not found: ' + localPath).toString('base64'),
          error: 'File not found',
        },
        timestamp: Date.now(),
      }));
      return;
    }

    // Read file content
    const fileContent = fs.readFileSync(localPath);

    // Determine content type based on file extension
    const ext = path.extname(localPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Send response
    ws.send(JSON.stringify({
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: 200,
        headers: { 'Content-Type': contentType },
        body: fileContent.toString('base64'),
      },
      timestamp: Date.now(),
    }));
  } catch (err) {
    const error = err as Error;
    console.error('[Agent] handleFileRequest error:', error);
    ws.send(JSON.stringify({
      type: 'http:response',
      sessionId,
      payload: {
        requestId,
        status: 500,
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