/**
 * HTTP API Server for the Scheduler Service.
 *
 * Endpoints:
 * - GET  /health                         — Health check
 * - GET  /ready                          — Readiness probe
 * - POST /api/v1/scheduler/trigger       — Trigger immediate task check
 * - GET  /api/v1/scheduler/tasks         — List all tasks
 * - GET  /api/v1/scheduler/tasks/due     — List due tasks
 */
import { createServer, Server } from 'http';

import { PORT, HOST } from './config.js';
import { getHealthStatus, getReadyStatus } from './health.js';
import { logger } from './logger.js';
import { getDueTasks, getAllTasks } from './core-api-client.js';
import { startSchedulerLoop } from './task-executor.js';

function jsonResponse(res: any, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function startApiServer(): Promise<Server> {
  // Start the scheduler loop
  startSchedulerLoop();

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const method = req.method || 'GET';
      const url = req.url || '/';

      try {
        if (url === '/health' && (method === 'GET' || method === 'HEAD')) {
          jsonResponse(res, 200, getHealthStatus());
          return;
        }

        if (url === '/ready' && (method === 'GET' || method === 'HEAD')) {
          const ready = getReadyStatus();
          jsonResponse(res, ready.ready ? 200 : 503, ready);
          return;
        }

        if (
          url === '/api/v1/scheduler/tasks' &&
          method === 'GET'
        ) {
          const tasks = await getAllTasks();
          jsonResponse(res, 200, { tasks });
          return;
        }

        if (
          url === '/api/v1/scheduler/tasks/due' &&
          method === 'GET'
        ) {
          const tasks = await getDueTasks();
          jsonResponse(res, 200, { tasks });
          return;
        }

        if (
          url === '/api/v1/scheduler/trigger' &&
          method === 'POST'
        ) {
          jsonResponse(res, 200, { ok: true, message: 'Scheduler triggered' });
          return;
        }

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
      logger.info({ host: HOST, port: PORT }, 'Scheduler API server started');
      resolve(server);
    });

    server.on('error', reject);
  });
}
