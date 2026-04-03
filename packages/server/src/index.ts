import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from './config/index.js';
import { initDatabase } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { setupWebSocket } from './ws/index.js';
import { startProxyServer } from './proxy/index.js';

const fastify = Fastify({ logger: true });

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