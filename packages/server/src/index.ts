import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from './config/index.js';
import { initDatabase } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { blackboxRoutes } from './routes/blackbox.js';
import { setupWebSocket } from './ws/index.js';
import { startProxyServer } from './proxy/index.js';
import { VoiceAgentManager } from './voice/voiceAgent.js';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

// Initialize voice system
let voiceAgentManager: VoiceAgentManager | null = null;
console.log(`[voice] Voice config: enabled=${config.voice.enabled}, baiduApiKey=${config.voice.baiduApiKey ? 'set' : 'NOT SET'}, llmProvider=${config.voice.llmProvider}`);
if (config.voice.enabled && config.voice.baiduApiKey) {
  console.log('[voice] Creating VoiceAgentManager...');
  voiceAgentManager = new VoiceAgentManager({
    stt: {
      provider: 'baidu',
      appId: config.voice.baiduAppId,
      apiKey: config.voice.baiduApiKey,
      secretKey: config.voice.baiduSecretKey,
    },
    tts: {
      provider: 'edge-tts',
      voice: config.voice.ttsVoice,
      rate: config.voice.ttsRate,
    },
    llm: {
      timeout_ms: 10000,
      max_retries: 2,
      // 服务器端 LLM 配置
      provider: config.voice.llmProvider as 'openai' | 'baidu' | 'none',
      apiUrl: config.voice.llmApiUrl || undefined,
      apiKey: config.voice.llmApiKey || undefined,
      model: config.voice.llmModel || undefined,
      baiduApiKey: config.voice.baiduApiKey,
      baiduSecretKey: config.voice.baiduSecretKey,
    },
    vad: { command_silence_ms: 800, terminal_command_silence_ms: 1200 },
  });

  // Load action map if available
  try {
    const actionMapPath = join(__dirname, 'voice/actionMap.json');
    const actionMap = JSON.parse(readFileSync(actionMapPath, 'utf-8'));
    voiceAgentManager.setActionMap(actionMap);
    console.log(`[voice] Action map loaded: ${actionMap.actions?.length || 0} actions`);
  } catch {
    console.log('[voice] No action map found, LLM fallback will have limited context');
  }

  console.log('[voice] Voice system initialized');
} else {
  console.log('[voice] Voice system disabled (set VOICE_ENABLED=true and BAIDU_API_KEY)');
}

// Export for use in router
export { voiceAgentManager };

await fastify.register(cors, { origin: '*' });
await fastify.register(jwt, { secret: config.jwtSecret });

// Register routes
await fastify.register(authRoutes);
await fastify.register(adminRoutes);
await fastify.register(blackboxRoutes);

// Health check
fastify.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

// Serve static files from web directory
const webPath = join(__dirname, '../../web');
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Explicit routes for common paths
fastify.get('/', async (request, reply) => {
  const indexPath = join(webPath, 'index.html');
  if (existsSync(indexPath)) {
    reply.header('Content-Type', 'text/html').send(readFileSync(indexPath));
  } else {
    reply.code(404).send({ error: 'index.html not found' });
  }
});

fastify.get('/login', async (request, reply) => {
  const indexPath = join(webPath, 'index.html');
  if (existsSync(indexPath)) {
    reply.header('Content-Type', 'text/html').send(readFileSync(indexPath));
  } else {
    reply.code(404).send({ error: 'index.html not found' });
  }
});

fastify.get('/terminal', async (request, reply) => {
  const indexPath = join(webPath, 'index.html');
  if (existsSync(indexPath)) {
    reply.header('Content-Type', 'text/html').send(readFileSync(indexPath));
  } else {
    reply.code(404).send({ error: 'index.html not found' });
  }
});

fastify.get('/files', async (request, reply) => {
  const indexPath = join(webPath, 'index.html');
  if (existsSync(indexPath)) {
    reply.header('Content-Type', 'text/html').send(readFileSync(indexPath));
  } else {
    reply.code(404).send({ error: 'index.html not found' });
  }
});

fastify.get('/settings', async (request, reply) => {
  const indexPath = join(webPath, 'index.html');
  if (existsSync(indexPath)) {
    reply.header('Content-Type', 'text/html').send(readFileSync(indexPath));
  } else {
    reply.code(404).send({ error: 'index.html not found' });
  }
});

// Serve assets and other static files
fastify.get('/assets/*', async (request, reply) => {
  const url = request.url.split('?')[0];
  const filePath = join(webPath, url);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const content = readFileSync(filePath);
    reply.header('Content-Type', contentType).send(content);
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

fastify.get('/favicon.svg', async (request, reply) => {
  const filePath = join(webPath, 'favicon.svg');
  if (existsSync(filePath)) {
    reply.header('Content-Type', 'image/svg+xml').send(readFileSync(filePath));
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

fastify.get('/manifest.webmanifest', async (request, reply) => {
  const filePath = join(webPath, 'manifest.webmanifest');
  if (existsSync(filePath)) {
    reply.header('Content-Type', 'application/manifest+json').send(readFileSync(filePath));
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

fastify.get('/sw.js', async (request, reply) => {
  const filePath = join(webPath, 'sw.js');
  if (existsSync(filePath)) {
    reply.header('Content-Type', 'application/javascript').send(readFileSync(filePath));
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

fastify.get('/registerSW.js', async (request, reply) => {
  const filePath = join(webPath, 'registerSW.js');
  if (existsSync(filePath)) {
    reply.header('Content-Type', 'application/javascript').send(readFileSync(filePath));
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

// Start server
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

start();