/**
 * Route Definitions — Maps API paths to backend services.
 *
 * Each route specifies which backend to forward to.
 * The API Gateway is a pure router — no business logic.
 */
import { IncomingMessage, ServerResponse } from 'http';

import { CORE_SERVICE_URL, WHATSAPP_GATEWAY_URL, ORCHESTRATOR_URL, SCHEDULER_URL } from './config.js';
import { proxyRequest } from './proxy.js';
import { logger } from './logger.js';

interface Route {
  method: string;
  pathPrefix: string;
  backend: string;
  description: string;
}

/**
 * Route table. Order matters — first match wins.
 *
 * Inbound flow:  WhatsApp Gateway → API Gateway → Core Service
 * Outbound flow: Core Service → API Gateway → WhatsApp Gateway
 */
const routes: Route[] = [
  // ─── Inbound (WhatsApp Gateway → Core) ───
  {
    method: 'POST',
    pathPrefix: '/api/v1/messages/inbound',
    backend: CORE_SERVICE_URL,
    description: 'Inbound message to Core',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/chat-metadata',
    backend: CORE_SERVICE_URL,
    description: 'Chat metadata to Core',
  },

  // ─── Outbound (Core → WhatsApp Gateway) ───
  {
    method: 'POST',
    pathPrefix: '/api/v1/messages/outbound',
    backend: WHATSAPP_GATEWAY_URL,
    description: 'Outbound message to WhatsApp',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/typing',
    backend: WHATSAPP_GATEWAY_URL,
    description: 'Typing indicator to WhatsApp',
  },

  // ─── Group operations ───
  {
    method: 'GET',
    pathPrefix: '/api/v1/groups/registered',
    backend: CORE_SERVICE_URL,
    description: 'Registered groups from Core',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/groups/available',
    backend: CORE_SERVICE_URL,
    description: 'Available groups from Core',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/groups/sync',
    backend: WHATSAPP_GATEWAY_URL,
    description: 'Group sync to WhatsApp',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/groups/join',
    backend: WHATSAPP_GATEWAY_URL,
    description: 'Join group via WhatsApp',
  },

  // ─── Data endpoints (Core Service — DB owner) ───
  {
    method: 'GET',
    pathPrefix: '/api/v1/messages',
    backend: CORE_SERVICE_URL,
    description: 'Message queries from Core',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/chats',
    backend: CORE_SERVICE_URL,
    description: 'Chat queries from Core',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/tasks',
    backend: CORE_SERVICE_URL,
    description: 'Task queries from Core',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/tasks',
    backend: CORE_SERVICE_URL,
    description: 'Task updates to Core',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/sessions',
    backend: CORE_SERVICE_URL,
    description: 'Session queries from Core',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/sessions',
    backend: CORE_SERVICE_URL,
    description: 'Session updates to Core',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/state',
    backend: CORE_SERVICE_URL,
    description: 'Router state queries from Core',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/state',
    backend: CORE_SERVICE_URL,
    description: 'Router state updates to Core',
  },
  {
    method: 'POST',
    pathPrefix: '/api/v1/send',
    backend: CORE_SERVICE_URL,
    description: 'Send message via Core',
  },

  // ─── Orchestrator operations ───
  {
    method: 'POST',
    pathPrefix: '/api/v1/orchestrator',
    backend: ORCHESTRATOR_URL,
    description: 'Orchestrator operations',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/orchestrator',
    backend: ORCHESTRATOR_URL,
    description: 'Orchestrator queries',
  },

  // ─── Scheduler operations ───
  {
    method: 'POST',
    pathPrefix: '/api/v1/scheduler',
    backend: SCHEDULER_URL,
    description: 'Scheduler operations',
  },
  {
    method: 'GET',
    pathPrefix: '/api/v1/scheduler',
    backend: SCHEDULER_URL,
    description: 'Scheduler queries',
  },
];

/**
 * Route an incoming API request to the appropriate backend.
 * Returns true if a route matched, false otherwise.
 */
export function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const method = req.method || 'GET';
  const url = req.url || '/';

  for (const route of routes) {
    if (method === route.method && url.startsWith(route.pathPrefix)) {
      logger.info(
        { method, path: url, backend: route.backend },
        `Routing: ${route.description}`,
      );
      proxyRequest(req, res, route.backend, url);
      return true;
    }
  }

  return false;
}
