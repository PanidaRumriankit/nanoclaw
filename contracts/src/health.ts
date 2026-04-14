/**
 * Health Check Contracts
 *
 * Every service exposes GET /health and GET /ready.
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
  uptime: number; // seconds
  dependencies: DependencyHealth[];
}

export interface ReadyResponse {
  ready: boolean;
}
