import http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import {
  observeAgentRun,
  recordStoredMessage,
  resetMetricsForTests,
  setRegisteredGroupCount,
  startMetricsServer,
} from './metrics.js';

function makeRequest(
  port: number,
  path: string,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<{
  statusCode: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('metrics', () => {
  let server: http.Server | null = null;

  beforeEach(() => {
    resetMetricsForTests();
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  it('serves Prometheus metrics on /metrics', async () => {
    recordStoredMessage();
    observeAgentRun('message', 'success', 1500);
    setRegisteredGroupCount(2);

    server = await startMetricsServer(0, '127.0.0.1');
    const port = (server.address() as AddressInfo).port;
    const response = await makeRequest(port, '/metrics');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain;/);
    expect(response.body).toContain('nanoclaw_process_cpu_user_seconds_total');
    expect(response.body).toContain('nanoclaw_messages_total 1');
    expect(response.body).toContain('nanoclaw_active_containers 0');
    expect(response.body).toContain('nanoclaw_registered_groups 2');
    expect(response.body).toContain(
      'nanoclaw_agent_runs_total{kind="message",status="success"} 1',
    );
  });

  it('returns 404 for unknown paths', async () => {
    server = await startMetricsServer(0, '127.0.0.1');
    const port = (server.address() as AddressInfo).port;
    const response = await makeRequest(port, '/nope');

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('supports HEAD requests for /metrics', async () => {
    server = await startMetricsServer(0, '127.0.0.1');
    const port = (server.address() as AddressInfo).port;
    const response = await makeRequest(port, '/metrics', 'HEAD');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain;/);
    expect(response.body).toBe('');
  });
});
