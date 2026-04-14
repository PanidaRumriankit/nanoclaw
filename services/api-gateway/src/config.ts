/**
 * API Gateway Configuration
 *
 * All config via environment variables with sensible defaults.
 */

export const PORT = parseInt(process.env.PORT || '4000', 10);
export const HOST = process.env.HOST || '0.0.0.0';

/** URL of the Core Service (monolith running on host) */
export const CORE_SERVICE_URL =
  process.env.CORE_SERVICE_URL || 'http://localhost:4001';

/** URL of the WhatsApp Gateway service */
export const WHATSAPP_GATEWAY_URL =
  process.env.WHATSAPP_GATEWAY_URL || 'http://localhost:4002';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const SERVICE_NAME = 'api-gateway';
export const SERVICE_VERSION = '1.0.0';

/** URL of the Orchestrator service */
export const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || 'http://nanoclaw-orchestrator:4003';

/** URL of the Scheduler service */
export const SCHEDULER_URL =
  process.env.SCHEDULER_URL || 'http://nanoclaw-scheduler:4004';
