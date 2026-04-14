/**
 * NanoClaw API Gateway
 *
 * Lightweight HTTP router that routes inter-service requests
 * to the appropriate backend (Core Service or WhatsApp Gateway).
 *
 * No business logic — pure routing and health aggregation.
 */
import { createServer } from 'http';

import { PORT, HOST, SERVICE_NAME } from './config.js';
import { routeRequest } from './routes.js';
import { getHealthStatus, getReadyStatus } from './health.js';
import { logger } from './logger.js';

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';

  // ─── Health endpoints ───
  if (url === '/health' && (method === 'GET' || method === 'HEAD')) {
    try {
      const health = await getHealthStatus();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      if (method === 'HEAD') {
        res.end();
        return;
      }
      res.end(JSON.stringify(health, null, 2));
    } catch (err) {
      logger.error({ err }, 'Health check error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Health check failed' }));
    }
    return;
  }

  if (url === '/ready' && (method === 'GET' || method === 'HEAD')) {
    const ready = getReadyStatus();
    res.writeHead(ready.ready ? 200 : 503, {
      'Content-Type': 'application/json',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(JSON.stringify(ready));
    return;
  }

  // ─── API routes ───
  if (url.startsWith('/api/')) {
    const routed = routeRequest(req, res);
    if (routed) return;
  }

  // ─── 404 ───
  logger.debug({ method, url }, 'No route matched');
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', path: url }));
});

server.listen(PORT, HOST, () => {
  logger.info(
    { service: SERVICE_NAME, host: HOST, port: PORT },
    'API Gateway started',
  );
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(() => {
    logger.info('API Gateway stopped');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
