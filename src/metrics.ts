import { createServer, Server } from 'http';
import net from 'net';

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

import { logger } from './logger.js';

export type AgentRunKind = 'message' | 'scheduled_task';
export type AgentRunStatus = 'error' | 'success';

const registry = new Registry();
let activeContainers = 0;

collectDefaultMetrics({
  register: registry,
  prefix: 'nanoclaw_',
});

const messagesTotal = new Counter({
  name: 'nanoclaw_messages_total',
  help: 'Total messages processed by the NanoClaw core process.',
  registers: [registry],
});

const agentRunsTotal = new Counter<'kind' | 'status'>({
  name: 'nanoclaw_agent_runs_total',
  help: 'Total container agent runs started by the NanoClaw core process.',
  labelNames: ['kind', 'status'],
  registers: [registry],
});

const agentRunDurationSeconds = new Histogram<'kind' | 'status'>({
  name: 'nanoclaw_agent_run_duration_seconds',
  help: 'Duration of NanoClaw container agent runs in seconds.',
  labelNames: ['kind', 'status'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900, 1800],
  registers: [registry],
});

const registeredGroupsGauge = new Gauge({
  name: 'nanoclaw_registered_groups',
  help: 'Number of registered groups currently loaded in the core process.',
  registers: [registry],
});

const activeContainersGauge = new Gauge({
  name: 'nanoclaw_active_containers',
  help: 'Number of active agent containers currently running.',
  registers: [registry],
});

const networkConnectionsTotal = new Counter<'remote_ip'>({
  name: 'nanoclaw_network_connections_total',
  help: 'Total outbound network connections opened by the core process.',
  labelNames: ['remote_ip'],
  registers: [registry],
});

const networkBytesReadTotal = new Counter<'remote_ip'>({
  name: 'nanoclaw_network_bytes_read_total',
  help: 'Total bytes read from each remote IP by the core process.',
  labelNames: ['remote_ip'],
  registers: [registry],
});

const networkBytesWrittenTotal = new Counter<'remote_ip'>({
  name: 'nanoclaw_network_bytes_written_total',
  help: 'Total bytes written to each remote IP by the core process.',
  labelNames: ['remote_ip'],
  registers: [registry],
});

const networkActiveConnectionsGauge = new Gauge<'remote_ip'>({
  name: 'nanoclaw_network_active_connections',
  help: 'Current outbound network connections by remote IP.',
  labelNames: ['remote_ip'],
  registers: [registry],
});

registeredGroupsGauge.set(0);
activeContainersGauge.set(0);

let networkUsageTrackingInstalled = false;
const trackedSockets = new WeakSet<net.Socket>();

export function recordStoredMessage(): void {
  messagesTotal.inc();
}

export function observeAgentRun(
  kind: AgentRunKind,
  status: AgentRunStatus,
  durationMs: number,
): void {
  agentRunsTotal.inc({ kind, status });
  agentRunDurationSeconds.observe({ kind, status }, durationMs / 1000);
}

export function setRegisteredGroupCount(count: number): void {
  registeredGroupsGauge.set(count);
}

export function markContainerStarted(): void {
  activeContainers += 1;
  activeContainersGauge.set(activeContainers);
}

export function markContainerFinished(): void {
  activeContainers = Math.max(0, activeContainers - 1);
  activeContainersGauge.set(activeContainers);
}

export function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export function resetMetricsForTests(): void {
  registry.resetMetrics();
  activeContainers = 0;
  registeredGroupsGauge.set(0);
  activeContainersGauge.set(0);
}

function normalizeRemoteIp(address?: string | null): string | null {
  if (!address) return null;
  if (address.startsWith('::ffff:')) {
    return address.slice('::ffff:'.length);
  }
  return address;
}

function trackSocket(socket: net.Socket): void {
  if (trackedSockets.has(socket)) return;
  trackedSockets.add(socket);

  let remoteIp: string | null = null;
  let pendingReadBytes = 0;
  let pendingWrittenBytes = 0;
  let lastBytesWritten = 0;
  let activeCounted = false;
  let finalized = false;

  const flushReadBytes = (size: number) => {
    if (size <= 0) return;
    if (remoteIp) {
      networkBytesReadTotal.inc({ remote_ip: remoteIp }, size);
    } else {
      pendingReadBytes += size;
    }
  };

  const flushWrittenBytes = (size: number) => {
    if (size <= 0) return;
    if (remoteIp) {
      networkBytesWrittenTotal.inc({ remote_ip: remoteIp }, size);
    } else {
      pendingWrittenBytes += size;
    }
  };

  const establishRemoteIp = () => {
    if (remoteIp) return;
    remoteIp = normalizeRemoteIp(socket.remoteAddress);
    if (!remoteIp) return;

    networkConnectionsTotal.inc({ remote_ip: remoteIp });
    networkActiveConnectionsGauge.inc({ remote_ip: remoteIp });
    activeCounted = true;

    if (pendingReadBytes > 0) {
      networkBytesReadTotal.inc({ remote_ip: remoteIp }, pendingReadBytes);
      pendingReadBytes = 0;
    }
    if (pendingWrittenBytes > 0) {
      networkBytesWrittenTotal.inc(
        { remote_ip: remoteIp },
        pendingWrittenBytes,
      );
      pendingWrittenBytes = 0;
    }
  };

  const flushSocketWrittenBytes = () => {
    const delta = socket.bytesWritten - lastBytesWritten;
    if (delta <= 0) return;
    lastBytesWritten = socket.bytesWritten;
    flushWrittenBytes(delta);
  };

  const finishConnection = () => {
    if (finalized) return;
    finalized = true;
    flushSocketWrittenBytes();
    establishRemoteIp();
    if (remoteIp && activeCounted) {
      networkActiveConnectionsGauge.dec({ remote_ip: remoteIp });
    }
  };

  socket.once('connect', establishRemoteIp);
  socket.once('close', finishConnection);
  socket.once('error', finishConnection);
  socket.on('data', (chunk) => {
    flushReadBytes(chunk.length);
  });

  const originalWrite = socket.write;
  socket.write = function patchedWrite(
    this: net.Socket,
    ...args: unknown[]
  ): boolean {
    const result = (originalWrite as (...callArgs: unknown[]) => boolean).apply(
      this,
      args,
    );
    setImmediate(flushSocketWrittenBytes);
    return result;
  };

  const originalEnd = socket.end;
  socket.end = function patchedEnd(
    this: net.Socket,
    ...args: unknown[]
  ): net.Socket {
    const result = (
      originalEnd as (...callArgs: unknown[]) => net.Socket
    ).apply(this, args);
    setImmediate(flushSocketWrittenBytes);
    return result;
  };
}

export function installNetworkUsageTracking(): void {
  if (networkUsageTrackingInstalled) return;
  networkUsageTrackingInstalled = true;

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(
    this: net.Socket,
    ...args: unknown[]
  ) {
    trackSocket(this);
    return (originalConnect as (...callArgs: unknown[]) => net.Socket).apply(
      this,
      args,
    );
  };
}

export function startMetricsServer(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      if (url.pathname !== '/metrics') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      try {
        const body = await renderMetrics();
        res.setHeader('Content-Type', registry.contentType);
        res.writeHead(200);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(body);
      } catch (err) {
        logger.error({ err }, 'Failed to render Prometheus metrics');
        res.writeHead(500);
        res.end('Failed to collect metrics');
      }
    });

    server.listen(port, host, () => {
      const address = server.address();
      const boundPort =
        typeof address === 'object' && address ? address.port : port;
      logger.info(
        { host, port: boundPort, path: '/metrics' },
        'Prometheus metrics server started',
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}
