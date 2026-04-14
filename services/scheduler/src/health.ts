const startTime = Date.now();

export function getHealthStatus() {
  return {
    service: 'scheduler',
    version: '1.0.0',
    status: 'healthy' as const,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    dependencies: [],
  };
}

export function getReadyStatus() {
  return { ready: true };
}
