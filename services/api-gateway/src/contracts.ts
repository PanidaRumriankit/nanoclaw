/**
 * Shared contract types for NanoClaw services.
 * Canonical source: contracts/src/api.ts + contracts/src/health.ts
 */

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyHealth {
  name: string;
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  service: string;
  version: string;
  status: ServiceStatus;
  uptime: number;
  dependencies: DependencyHealth[];
}

export interface ReadyResponse {
  ready: boolean;
}
