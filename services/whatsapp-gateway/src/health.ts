/**
 * Health check — reports WhatsApp connection status.
 */
import type { HealthResponse, ServiceStatus } from './contracts.js';

import { SERVICE_NAME, SERVICE_VERSION } from './config.js';
import { isConnected } from './whatsapp.js';

const startTime = Date.now();

export function getHealthStatus(): HealthResponse {
  const waStatus: ServiceStatus = isConnected() ? 'healthy' : 'unhealthy';

  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: waStatus,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    dependencies: [
      {
        name: 'whatsapp',
        status: waStatus,
      },
    ],
  };
}
