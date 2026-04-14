/**
 * Health Check for Orchestrator Service
 */
import { SERVICE_NAME, SERVICE_VERSION } from './config.js';

const startTime = Date.now();

export function getHealthStatus() {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: 'healthy' as const,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    dependencies: [],
  };
}

export function getReadyStatus() {
  return { ready: true };
}
