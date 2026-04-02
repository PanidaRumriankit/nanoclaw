import net from 'net';
import type { AddressInfo } from 'net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import {
  installNetworkUsageTracking,
  renderMetrics,
  resetMetricsForTests,
} from './metrics.js';

describe('network usage metrics', () => {
  let server: net.Server | null = null;

  beforeEach(() => {
    installNetworkUsageTracking();
    resetMetricsForTests();
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  it('tracks connections and bytes by remote IP', async () => {
    server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        expect(chunk.toString()).toBe('hello');
        socket.write('world');
        socket.end();
      });
    });

    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', () => resolve()),
    );
    const port = (server.address() as AddressInfo).port;

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection({ host: '127.0.0.1', port });
      client.on('connect', () => {
        client.write('hello');
      });
      client.on('data', () => {
        // read side is tracked by the socket listener installed in metrics.ts
      });
      client.on('close', () => resolve());
      client.on('error', reject);
    });

    const metrics = await renderMetrics();
    expect(metrics).toContain(
      'nanoclaw_network_connections_total{remote_ip="127.0.0.1"} 1',
    );
    expect(metrics).toContain(
      'nanoclaw_network_bytes_written_total{remote_ip="127.0.0.1"} 5',
    );
    expect(metrics).toContain(
      'nanoclaw_network_bytes_read_total{remote_ip="127.0.0.1"} 5',
    );
    expect(metrics).toContain(
      'nanoclaw_network_active_connections{remote_ip="127.0.0.1"} 0',
    );
  });
});
