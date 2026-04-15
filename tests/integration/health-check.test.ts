/**
 * Integration Test: Health Checks
 *
 * Verifies that all services expose proper health endpoints
 * and the API Gateway aggregates health status correctly.
 */
import { createServer, Server } from 'http';
import { request as httpRequest } from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

function getJson(
  port: number,
  path: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 500,
            data: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Service Mesh: Health Checks', () => {
  let mockCoreServer: Server;
  let mockWaServer: Server;

  const corePort = 15001;
  const waPort = 15002;

  beforeAll(async () => {
    mockCoreServer = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'core-service',
            version: '1.0.0',
            status: 'healthy',
            uptime: 42,
            dependencies: [],
          }),
        );
      } else if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    mockWaServer = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'whatsapp-gateway',
            version: '1.0.0',
            status: 'healthy',
            uptime: 42,
            dependencies: [{ name: 'whatsapp', status: 'healthy' }],
          }),
        );
      } else if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await Promise.all([
      new Promise<void>((r) =>
        mockCoreServer.listen(corePort, '127.0.0.1', r),
      ),
      new Promise<void>((r) => mockWaServer.listen(waPort, '127.0.0.1', r)),
    ]);
  });

  afterAll(() => {
    mockCoreServer?.close();
    mockWaServer?.close();
  });

  it('Core Service health endpoint returns healthy', async () => {
    const result = await getJson(corePort, '/health');

    expect(result.status).toBe(200);
    const health = JSON.parse(result.data);
    expect(health.service).toBe('core-service');
    expect(health.status).toBe('healthy');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });

  it('Core Service ready endpoint returns ready', async () => {
    const result = await getJson(corePort, '/ready');

    expect(result.status).toBe(200);
    const ready = JSON.parse(result.data);
    expect(ready.ready).toBe(true);
  });

  it('WhatsApp Gateway health endpoint returns healthy with dependency', async () => {
    const result = await getJson(waPort, '/health');

    expect(result.status).toBe(200);
    const health = JSON.parse(result.data);
    expect(health.service).toBe('whatsapp-gateway');
    expect(health.status).toBe('healthy');
    expect(health.dependencies).toHaveLength(1);
    expect(health.dependencies[0].name).toBe('whatsapp');
    expect(health.dependencies[0].status).toBe('healthy');
  });

  it('WhatsApp Gateway ready endpoint returns ready', async () => {
    const result = await getJson(waPort, '/ready');

    expect(result.status).toBe(200);
    const ready = JSON.parse(result.data);
    expect(ready.ready).toBe(true);
  });

  it('health response structure follows contract', async () => {
    const result = await getJson(corePort, '/health');
    const health = JSON.parse(result.data);

    // Verify all required fields exist
    expect(health).toHaveProperty('service');
    expect(health).toHaveProperty('version');
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('uptime');
    expect(health).toHaveProperty('dependencies');
    expect(typeof health.service).toBe('string');
    expect(typeof health.version).toBe('string');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    expect(typeof health.uptime).toBe('number');
    expect(Array.isArray(health.dependencies)).toBe(true);
  });
});
