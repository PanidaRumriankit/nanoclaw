/**
 * NanoClaw WhatsApp Gateway
 *
 * Manages the Baileys WebSocket connection to WhatsApp and exposes
 * an HTTP API for sending messages, typing indicators, and group operations.
 *
 * Inbound messages from WhatsApp are pushed upstream to the API Gateway.
 */
import { SERVICE_NAME } from './config.js';
import { connectWhatsApp } from './whatsapp.js';
import { startApiServer } from './api-server.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  logger.info({ service: SERVICE_NAME }, 'Starting WhatsApp Gateway...');

  // Start the API server first (so the service is reachable for health checks)
  const server = await startApiServer();

  // Connect to WhatsApp
  try {
    await connectWhatsApp();
    logger.info('WhatsApp connection established');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to WhatsApp');
    // Keep running — the reconnection logic in whatsapp.ts will handle retries
  }

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(() => {
      logger.info('WhatsApp Gateway stopped');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'WhatsApp Gateway failed to start');
  process.exit(1);
});
