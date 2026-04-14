/**
 * NanoClaw Orchestrator
 *
 * Message processing, agent routing, and container lifecycle management.
 * Uses Core API (monolith) for all data operations.
 */
import { SERVICE_NAME } from './config.js';
import { ensureContainerRuntimeRunning, cleanupOrphans } from './container-runtime.js';
import { logger } from './logger.js';
import {
  loadState,
  startMessageLoop,
  recoverPendingMessages,
} from './orchestrator.js';
import { startApiServer } from './api-server.js';

async function main(): Promise<void> {
  logger.info({ service: SERVICE_NAME }, 'Starting Orchestrator...');

  // Ensure container runtime is available
  try {
    ensureContainerRuntimeRunning();
    cleanupOrphans();
  } catch (err) {
    logger.warn({ err }, 'Container runtime not available at startup');
  }

  // Load state from Core API (fetches registered groups, sessions, etc.)
  await loadState();

  // Start API server
  const server = await startApiServer();

  // Start message loop
  startMessageLoop();

  // Recovery
  await recoverPendingMessages();

  logger.info('Orchestrator started successfully');

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(() => {
      logger.info('Orchestrator stopped');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Orchestrator failed to start');
  process.exit(1);
});
