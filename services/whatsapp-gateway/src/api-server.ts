/**
 * HTTP API Server for inbound requests to the WhatsApp Gateway.
 *
 * Receives commands from the API Gateway (originated by Core Service):
 * - POST /api/v1/messages/outbound — send a message via WhatsApp
 * - POST /api/v1/typing — set typing indicator
 * - POST /api/v1/groups/sync — trigger group metadata sync
 * - POST /api/v1/groups/join — join a group via invite
 * - GET  /health — health check
 * - GET  /ready — readiness probe
 */
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

import type {
  OutboundMessageRequest,
  TypingRequest,
  GroupSyncRequest,
  GroupJoinRequest,
} from './contracts.js';

import { PORT, HOST, SERVICE_NAME, SERVICE_VERSION } from './config.js';
import {
  sendMessage,
  setTyping,
  syncGroupMetadata,
  joinGroup,
  isConnected,
} from './whatsapp.js';
import { logger } from './logger.js';

const startTime = Date.now();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: object,
): void {
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
          const health = {
            service: SERVICE_NAME,
            version: SERVICE_VERSION,
            status: isConnected() ? 'healthy' : 'degraded',
            uptime: Math.floor((Date.now() - startTime) / 1000),
            dependencies: [
              {
                name: 'whatsapp',
                status: isConnected() ? 'healthy' : 'unhealthy',
              },
            ],
          };
          jsonResponse(res, isConnected() ? 200 : 503, health);
          return;
        }

        if (url === '/ready' && (method === 'GET' || method === 'HEAD')) {
          jsonResponse(res, isConnected() ? 200 : 503, {
            ready: isConnected(),
          });
          return;
        }

        // ─── Outbound message ───
        if (
          url === '/api/v1/messages/outbound' &&
          method === 'POST'
        ) {
          const body = JSON.parse(await readBody(req)) as OutboundMessageRequest;
          await sendMessage(body.chatJid, body.text);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Typing indicator ───
        if (url === '/api/v1/typing' && method === 'POST') {
          const body = JSON.parse(await readBody(req)) as TypingRequest;
          await setTyping(body.chatJid, body.isTyping);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Group sync ───
        if (url === '/api/v1/groups/sync' && method === 'POST') {
          const body = JSON.parse(await readBody(req)) as GroupSyncRequest;
          const count = await syncGroupMetadata(body.force);
          jsonResponse(res, 200, { ok: true, count });
          return;
        }

        // ─── Group join ───
        if (url === '/api/v1/groups/join' && method === 'POST') {
          const body = JSON.parse(await readBody(req)) as GroupJoinRequest;
          try {
            const jid = await joinGroup(body.invite);
            jsonResponse(res, 200, { ok: true, jid });
          } catch (err) {
            jsonResponse(res, 500, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
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
      logger.info(
        { service: SERVICE_NAME, host: HOST, port: PORT },
        'WhatsApp Gateway API server started',
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}
