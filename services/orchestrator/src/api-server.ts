/**
 * HTTP API Server for the Orchestrator Service.
 *
 * Endpoints:
 * - GET  /health                              — Health check
 * - GET  /ready                               — Readiness probe
 * - POST /api/v1/orchestrator/process         — Trigger message processing
 * - GET  /api/v1/orchestrator/groups          — Get registered groups
 * - GET  /api/v1/orchestrator/stats           — Get queue stats
 */
import { createServer, Server } from 'http';

import { PORT, HOST } from './config.js';
import { getHealthStatus, getReadyStatus } from './health.js';
import { logger } from './logger.js';
import {
  loadState,
  getRegisteredGroupsLocal,
  getQueue,
  startMessageLoop,
  recoverPendingMessages,
} from './orchestrator.js';

function jsonResponse(res: any, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function startApiServer(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const method = req.method || 'GET';
      const url = req.url || '/';

      try {
        // ─── Health ───
        if (url === '/health' && (method === 'GET' || method === 'HEAD')) {
          jsonResponse(res, 200, getHealthStatus());
          return;
        }

        if (url === '/ready' && (method === 'GET' || method === 'HEAD')) {
          const ready = getReadyStatus();
          jsonResponse(res, ready.ready ? 200 : 503, ready);
          return;
        }

        // ─── Trigger message processing ───
        if (
          url === '/api/v1/orchestrator/process' &&
          method === 'POST'
        ) {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString());
              if (body.chatJid) {
                getQueue().enqueueMessageCheck(body.chatJid);
              }
            } catch {}
          });
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Get registered groups ───
        if (
          url === '/api/v1/orchestrator/groups' &&
          method === 'GET'
        ) {
          jsonResponse(res, 200, { groups: getRegisteredGroupsLocal() });
          return;
        }

        // ─── Get queue stats ───
        if (
          url === '/api/v1/orchestrator/stats' &&
          method === 'GET'
        ) {
          jsonResponse(res, 200, { stats: getQueue().getStats() });
          return;
        }

        // ─── 404 ───
        jsonResponse(res, 404, { error: 'Not Found', path: url });
      } catch (err) {
        logger.error({ err, method, url }, 'API server error');
        if (!res.headersSent) {
          jsonResponse(res, 500, {
            error: 'Internal Server Error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    server.listen(PORT, HOST, () => {
      logger.info({ host: HOST, port: PORT }, 'Orchestrator API server started');
      resolve(server);
    });

    server.on('error', reject);
  });
}
