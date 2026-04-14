/**
 * NanoClaw Agent Runner
 *
 * Stateless HTTP service that spawns agent containers on demand.
 * The monolith POSTs work to /run, gets results back.
 *
 * No database. No message loop. No scheduling. Just containers.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';

import { PORT, HOST, PROJECT_ROOT, SERVICE_NAME } from './config.js';
import { ensureContainerRuntimeRunning } from './container-runtime.js';
import { runContainerAgent, ContainerInput, ContainerOutput } from './container-runner.js';
import { logger } from './logger.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const startTime = Date.now();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method || 'GET';
  const url = req.url || '/';

  try {
    // Health
    if (url === '/health' && (method === 'GET' || method === 'HEAD')) {
      jsonResponse(res, 200, {
        service: SERVICE_NAME,
        version: '1.0.0',
        status: 'healthy',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        dependencies: [],
      });
      return;
    }

    if (url === '/ready' && (method === 'GET' || method === 'HEAD')) {
      jsonResponse(res, 200, { ready: true });
      return;
    }

    // Run agent container
    if (url === '/run' && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        group: { name: string; folder: string; isMain?: boolean };
        input: ContainerInput;
      };

      logger.info(
        { group: body.group.name, folder: body.group.folder, isMain: body.input.isMain },
        'Received run request',
      );

      const result = await runContainerAgent(body.group, body.input);

      logger.info(
        { group: body.group.name, status: result.status },
        'Run completed',
      );

      jsonResponse(res, 200, result);
      return;
    }

    jsonResponse(res, 404, { error: 'Not Found', path: url });
  } catch (err) {
    logger.error({ err, method, url }, 'Server error');
    if (!res.headersSent) {
      jsonResponse(res, 500, {
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

// Ensure project directories exist
for (const dir of ['groups', 'data', 'data/sessions', 'data/ipc', 'data/tmp']) {
  fs.mkdirSync(path.join(PROJECT_ROOT, dir), { recursive: true });
}

// Ensure container runtime is available
try {
  ensureContainerRuntimeRunning();
  logger.info('Container runtime available');
} catch (err) {
  logger.warn({ err }, 'Container runtime not available at startup');
}

server.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, 'Agent Runner started');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(() => {
    logger.info('Agent Runner stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
