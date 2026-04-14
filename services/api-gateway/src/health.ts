/**
 * Health Check Aggregation
 *
 * The API Gateway aggregates health from all downstream services
 * and reports an overall status.
 */
import type {
  HealthResponse,
  DependencyHealth,
  ServiceStatus,
} from './contracts.js';

import {
  CORE_SERVICE_URL,
  WHATSAPP_GATEWAY_URL,
  ORCHESTRATOR_URL,
  SCHEDULER_URL,
  SERVICE_NAME,
  SERVICE_VERSION,
} from './config.js';
import { fetchJson } from './proxy.js';
import { logger } from './logger.js';

const startTime = Date.now();

async function checkDependency(
  name: string,
  url: string,
): Promise<DependencyHealth> {
  try {
    const { data, latencyMs } = await fetchJson<HealthResponse>(
      `${url}/health`,
      3000,
    );
    return {
      name,
      status: data.status || 'healthy',
      latencyMs,
    };
  } catch (err) {
    logger.warn({ err, name, url }, 'Dependency health check failed');
    return {
      name,
      status: 'unhealthy',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function worstStatus(statuses: ServiceStatus[]): ServiceStatus {
  if (statuses.includes('unhealthy')) return 'unhealthy';
  if (statuses.includes('degraded')) return 'degraded';
  return 'healthy';
}

export async function getHealthStatus(): Promise<HealthResponse> {
  const [core, whatsapp, orchestrator, scheduler] = await Promise.all([
    checkDependency('core-service', CORE_SERVICE_URL),
    checkDependency('whatsapp-gateway', WHATSAPP_GATEWAY_URL),
    checkDependency('orchestrator', ORCHESTRATOR_URL),
    checkDependency('scheduler', SCHEDULER_URL),
  ]);

  const dependencies = [core, whatsapp, orchestrator, scheduler];
  const overall = worstStatus(dependencies.map((d) => d.status));

  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: overall,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    dependencies,
  };
}

export function getReadyStatus(): { ready: boolean } {
  // API Gateway is always ready as long as it's running
  // (it's a stateless proxy)
  return { ready: true };
}
