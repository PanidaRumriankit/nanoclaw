/**
 * Orchestrator Configuration
 */
export const PORT = parseInt(process.env.PORT || '4003', 10);
export const HOST = process.env.HOST || '0.0.0.0';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const SERVICE_NAME = 'orchestrator';
export const SERVICE_VERSION = '1.0.0';

/** Project root — bind-mounted from host */
export const PROJECT_ROOT = process.env.PROJECT_ROOT || '/app/project';

/** Bot identity */
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  process.env.ASSISTANT_HAS_OWN_NUMBER === 'true';

/** Container runtime */
export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
);

/** Credential proxy */
export const CREDENTIAL_PROXY_PORT = parseInt(
  process.env.CREDENTIAL_PROXY_PORT || '3001',
  10,
);

/** Timezone */
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Polling */
export const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000', 10);
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10);

/** Concurrency */
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

/** Models */
export const CLAUDE_CODE_MODEL = process.env.CLAUDE_CODE_MODEL;
export const ANTHROPIC_DEFAULT_HAIKU_MODEL =
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
export const ANTHROPIC_DEFAULT_SONNET_MODEL =
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
export const ANTHROPIC_DEFAULT_OPUS_MODEL =
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;

/** Host gateway for containers to reach host services */
export const HOST_GATEWAY = process.env.HOST_GATEWAY || 'host.docker.internal';

/** URL of the Core Service (monolith running on host) */
export const CORE_SERVICE_URL =
  process.env.CORE_SERVICE_URL || 'http://host.docker.internal:4001';
