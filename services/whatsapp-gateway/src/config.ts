/**
 * WhatsApp Gateway Configuration
 */

export const PORT = parseInt(process.env.PORT || '4002', 10);
export const HOST = process.env.HOST || '0.0.0.0';

/** URL of the API Gateway to push inbound messages to */
export const API_GATEWAY_URL =
  process.env.API_GATEWAY_URL || 'http://localhost:4000';

/** Path to WhatsApp auth credentials */
export const AUTH_DIR = process.env.AUTH_DIR || './store/auth';

/** Bot identity */
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  process.env.ASSISTANT_HAS_OWN_NUMBER === 'true';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const SERVICE_NAME = 'whatsapp-gateway';
export const SERVICE_VERSION = '1.0.0';

/** Interval between group metadata syncs */
export const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
