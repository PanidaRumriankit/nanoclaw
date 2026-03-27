import { createServer, Server } from 'http';

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

registeredGroupsGauge.set(0);
activeContainersGauge.set(0);

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
