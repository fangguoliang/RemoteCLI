import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from './config/index.js';
import { initDatabase } from './db/index.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: '*' });
await fastify.register(jwt, { secret: config.jwtSecret });

// Health check
fastify.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

// Start server
const start = async () => {
  try {
    // Initialize database
    await initDatabase();

    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server running on port ${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();