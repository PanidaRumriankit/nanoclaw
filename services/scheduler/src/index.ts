/**
 * NanoClaw Scheduler
 *
 * Handles cron and interval task execution.
 * Uses Core API for all data operations.
 */
import { SERVICE_NAME } from './config.js';
import { logger } from './logger.js';
import { startApiServer } from './api-server.js';

async function main(): Promise<void> {
  logger.info({ service: SERVICE_NAME }, 'Starting Scheduler...');

  // Start API server (also starts the scheduler loop)
  const server = await startApiServer();

  logger.info('Scheduler started successfully');

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(() => {
      logger.info('Scheduler stopped');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Scheduler failed to start');
  process.exit(1);
});
