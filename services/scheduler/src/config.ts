/**
 * Scheduler Configuration
 */
export const PORT = parseInt(process.env.PORT || '4004', 10);
export const HOST = process.env.HOST || '0.0.0.0';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const SERVICE_NAME = 'scheduler';
export const SERVICE_VERSION = '1.0.0';

export const PROJECT_ROOT = process.env.PROJECT_ROOT || '/app/project';
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';

export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const SCHEDULER_POLL_INTERVAL = parseInt(
  process.env.SCHEDULER_POLL_INTERVAL || '60000',
  10,
);

/** URL of the Orchestrator service (for triggering agent runs) */
export const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || 'http://nanoclaw-orchestrator:4003';

/** URL of the Core Service (monolith running on host) */
export const CORE_SERVICE_URL =
  process.env.CORE_SERVICE_URL || 'http://host.docker.internal:4001';
