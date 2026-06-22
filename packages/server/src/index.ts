import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from './config/index.js';
import { initDatabase } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { setupWebSocket } from './ws/index.js';
import { startProxyServer } from './proxy/index.js';
import { VoiceAgentManager } from './voice/voiceAgent.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

// Initialize voice system
let voiceAgentManager: VoiceAgentManager | null = null;
if (config.voice.enabled && config.voice.baiduApiKey) {
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
    llm: { timeout_ms: 10000, max_retries: 2 },
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

// Health check
fastify.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

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