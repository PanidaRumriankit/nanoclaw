/**
 * Agent Runner Client — HTTP client for the monolith to call the Agent Runner service.
 *
 * When AGENT_RUNNER_URL is set, the monolith uses this instead of
 * the local runContainerAgent() function.
 */
import { request as httpRequest } from 'http';
import { AgentRunnerConfig } from './config.js';
import { logger } from './logger.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';

export async function runContainerAgentRemote(
  group: { name: string; folder: string; isMain?: boolean },
  input: ContainerInput,
): Promise<ContainerOutput> {
  const url = new URL(AgentRunnerConfig.url);
  const payload = JSON.stringify({ group, input });

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 300_000, // 5 min — containers can take a while
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString()) as ContainerOutput;
            resolve(result);
          } catch (err) {
            reject(new Error('Failed to parse Agent Runner response'));
          }
        });
      },
    );

    req.on('error', (err) => {
      logger.error({ err, group: group.name }, 'Agent Runner request failed');
      resolve({ status: 'error', result: null, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'error', result: null, error: 'Agent Runner request timed out' });
    });

    req.write(payload);
    req.end();
  });
}
