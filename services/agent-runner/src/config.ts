/**
 * Agent Runner Configuration
 */
export const PORT = parseInt(process.env.PORT || '4005', 10);
export const HOST = process.env.HOST || '0.0.0.0';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const SERVICE_NAME = 'agent-runner';
export const SERVICE_VERSION = '1.0.0';

/** Project root — bind-mounted from host */
export const PROJECT_ROOT = process.env.PROJECT_ROOT || '/app/project';

/** Bot identity */
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';

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

/** Idle timeout */
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10);

/** Host gateway for containers to reach host services */
export const HOST_GATEWAY = process.env.HOST_GATEWAY || 'host.docker.internal';

/** Models */
export const CLAUDE_CODE_MODEL = process.env.CLAUDE_CODE_MODEL;
export const ANTHROPIC_DEFAULT_HAIKU_MODEL =
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
export const ANTHROPIC_DEFAULT_SONNET_MODEL =
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
export const ANTHROPIC_DEFAULT_OPUS_MODEL =
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
