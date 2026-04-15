/**
 * Core API Server
 *
 * HTTP server in the Core Service that:
 * 1. Receives inbound messages from the API Gateway (WhatsApp → Core)
 * 2. Exposes data endpoints for services (orchestrator, scheduler) to read/write
 *    through instead of accessing SQLite directly
 *
 * This is the single owner of the database. All services go through this API.
 */
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

import type {
  InboundMessageRequest,
  ChatMetadataRequest,
} from './service-contracts.js';

import { logger } from './logger.js';
import { NewMessage, RegisteredGroup } from './types.js';

export interface CoreApiDeps {
  /** Store an inbound message in the database */
  onMessage: (chatJid: string, msg: NewMessage) => void;
  /** Store chat metadata */
  onChatMetadata: (
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ) => void;
  /** Get current registered groups */
  registeredGroups: () => Record<string, RegisteredGroup>;
  /** Send a message via the appropriate channel */
  sendMessage: (jid: string, text: string) => Promise<void>;
  /** Get all chats */
  getAllChats: () => Array<{
    jid: string;
    name: string;
    last_message_time: string;
    is_group: boolean;
  }>;
  /** Get new messages for JIDs since timestamp */
  getNewMessages: (
    jids: string[],
    sinceTimestamp: string,
    assistantName: string,
  ) => { messages: NewMessage[]; newTimestamp: string };
  /** Get messages for a single chat since timestamp */
  getMessagesSince: (
    chatJid: string,
    sinceTimestamp: string,
    assistantName: string,
  ) => NewMessage[];
  /** Get all sessions */
  getAllSessions: () => Record<string, string>;
  /** Set a session */
  setSession: (groupFolder: string, sessionId: string) => void;
  /** Get router state */
  getRouterState: (key: string) => string | null;
  /** Set router state */
  setRouterState: (key: string, value: string) => void;
  /** Get all tasks */
  getAllTasks: () => Array<{
    id: string;
    group_folder: string;
    chat_jid: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    next_run: string | null;
    last_run: string | null;
    last_result: string | null;
    status: string;
    created_at: string;
  }>;
  /** Get due tasks */
  getDueTasks: () => Array<{
    id: string;
    group_folder: string;
    chat_jid: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    next_run: string | null;
    last_run: string | null;
    last_result: string | null;
    status: string;
    created_at: string;
  }>;
  /** Update a task */
  updateTask: (id: string, updates: Record<string, unknown>) => void;
  /** Update task after run (sets next_run, last_run, last_result) */
  updateTaskAfterRun: (
    id: string,
    nextRun: string | null,
    resultSummary: string,
  ) => void;
  /** Log a task run */
  logTaskRun: (log: {
    task_id: string;
    run_at: string;
    duration_ms: number;
    status: 'success' | 'error';
    result: string | null;
    error: string | null;
  }) => void;
  /** Get available groups (for agent context) */
  getAvailableGroups: () => Array<{
    jid: string;
    name: string;
    lastActivity: string;
    isRegistered: boolean;
  }>;
  /** Get sessions state */
  getSessions: () => Record<string, string>;
}

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

/**
 * Start the Core API server that receives traffic from the API Gateway.
 */
export function startCoreApiServer(
  port: number,
  host: string,
  deps: CoreApiDeps,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const method = req.method || 'GET';
      const url = req.url || '/';

      try {
        // ─── Health ───
        if (url === '/health' && (method === 'GET' || method === 'HEAD')) {
          jsonResponse(res, 200, {
            service: 'core-service',
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

        // ─── Inbound message (from WhatsApp Gateway) ───
        if (url === '/api/v1/messages/inbound' && method === 'POST') {
          const body = JSON.parse(await readBody(req)) as InboundMessageRequest;

          deps.onMessage(body.chatJid, {
            id: body.id,
            chat_jid: body.chatJid,
            sender: body.sender,
            sender_name: body.senderName,
            content: body.content,
            timestamp: body.timestamp,
            is_from_me: body.isFromMe,
            is_bot_message: body.isBotMessage,
          });

          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Chat metadata (from WhatsApp Gateway) ───
        if (url === '/api/v1/chat-metadata' && method === 'POST') {
          const body = JSON.parse(await readBody(req)) as ChatMetadataRequest;

          deps.onChatMetadata(
            body.chatJid,
            body.timestamp,
            body.name,
            body.channel,
            body.isGroup,
          );

          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Registered groups ───
        if (url === '/api/v1/groups/registered' && method === 'GET') {
          const groups = deps.registeredGroups();
          const response: Record<
            string,
            { jid: string; name: string; folder: string }
          > = {};
          for (const [jid, group] of Object.entries(groups)) {
            response[jid] = {
              jid,
              name: group.name,
              folder: group.folder,
            };
          }
          jsonResponse(res, 200, { groups: response });
          return;
        }

        // ════════════════════════════════════════════════════════════
        // Data API — used by orchestrator and scheduler services
        // ════════════════════════════════════════════════════════════

        // ─── Get new messages ───
        if (url.startsWith('/api/v1/messages/new') && method === 'GET') {
          const params = new URL(url, 'http://localhost').searchParams;
          const jidsParam = params.get('jids') || '';
          const since = params.get('since') || '';
          const assistantName = params.get('assistantName') || 'Andy';

          const jids = jidsParam ? jidsParam.split(',') : [];
          const result = deps.getNewMessages(jids, since, assistantName);
          jsonResponse(res, 200, result);
          return;
        }

        // ─── Get messages since timestamp for one chat ───
        if (url.startsWith('/api/v1/messages/since') && method === 'GET') {
          const params = new URL(url, 'http://localhost').searchParams;
          const chatJid = params.get('chatJid') || '';
          const since = params.get('since') || '';
          const assistantName = params.get('assistantName') || 'Andy';

          if (!chatJid) {
            jsonResponse(res, 400, { error: 'chatJid required' });
            return;
          }
          const messages = deps.getMessagesSince(chatJid, since, assistantName);
          jsonResponse(res, 200, { messages });
          return;
        }

        // ─── Get all chats ───
        if (url === '/api/v1/chats' && method === 'GET') {
          jsonResponse(res, 200, { chats: deps.getAllChats() });
          return;
        }

        // ─── Get due tasks ───
        if (url === '/api/v1/tasks/due' && method === 'GET') {
          jsonResponse(res, 200, { tasks: deps.getDueTasks() });
          return;
        }

        // ─── Get all tasks ───
        if (url === '/api/v1/tasks' && method === 'GET') {
          jsonResponse(res, 200, { tasks: deps.getAllTasks() });
          return;
        }

        // ─── Update task ───
        if (url.startsWith('/api/v1/tasks/') && method === 'POST') {
          const parts = url.split('/');
          // /api/v1/tasks/:id/update
          if (parts.length >= 5 && parts[4] === 'update') {
            const taskId = parts[3];
            const body = JSON.parse(await readBody(req));
            deps.updateTask(taskId, body.updates || {});
            jsonResponse(res, 200, { ok: true });
            return;
          }
          // /api/v1/tasks/:id/after-run
          if (parts.length >= 5 && parts[4] === 'after-run') {
            const taskId = parts[3];
            const body = JSON.parse(await readBody(req));
            deps.updateTaskAfterRun(taskId, body.nextRun, body.resultSummary);
            jsonResponse(res, 200, { ok: true });
            return;
          }
        }

        // ─── Log task run ───
        if (url === '/api/v1/tasks/log' && method === 'POST') {
          const body = JSON.parse(await readBody(req));
          deps.logTaskRun(body);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Sessions ───
        if (url === '/api/v1/sessions' && method === 'GET') {
          jsonResponse(res, 200, { sessions: deps.getAllSessions() });
          return;
        }
        if (url === '/api/v1/sessions' && method === 'POST') {
          const body = JSON.parse(await readBody(req));
          deps.setSession(body.groupFolder, body.sessionId);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Router state ───
        if (url.startsWith('/api/v1/state') && method === 'GET') {
          const params = new URL(url, 'http://localhost').searchParams;
          const key = params.get('key') || '';
          if (!key) {
            jsonResponse(res, 400, { error: 'key required' });
            return;
          }
          const value = deps.getRouterState(key);
          jsonResponse(res, 200, { key, value });
          return;
        }
        if (url === '/api/v1/state' && method === 'POST') {
          const body = JSON.parse(await readBody(req));
          deps.setRouterState(body.key, body.value);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Send message via channel ───
        if (url === '/api/v1/send' && method === 'POST') {
          const body = JSON.parse(await readBody(req));
          await deps.sendMessage(body.jid, body.text);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        // ─── Available groups (for agent snapshots) ───
        if (url === '/api/v1/groups/available' && method === 'GET') {
          jsonResponse(res, 200, {
            groups: deps.getAvailableGroups(),
          });
          return;
        }

        // ─── Sessions state (for orchestrator) ───
        if (url === '/api/v1/sessions/state' && method === 'GET') {
          jsonResponse(res, 200, { sessions: deps.getSessions() });
          return;
        }

        // ─── 404 ───
        jsonResponse(res, 404, { error: 'Not Found', path: url });
      } catch (err) {
        logger.error({ err, method, url }, 'Core API server error');
        if (!res.headersSent) {
          jsonResponse(res, 500, {
            error: 'Internal Server Error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    server.listen(port, host, () => {
      logger.info({ host, port, path: '/api/v1/*' }, 'Core API server started');
      resolve(server);
    });

    server.on('error', reject);
  });
}
