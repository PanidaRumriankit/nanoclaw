/**
 * Container Runtime — Docker/Podman abstraction.
 */
import { execSync } from 'child_process';
import { HOST_GATEWAY } from './config.js';
import { logger } from './logger.js';

export const CONTAINER_HOST_GATEWAY = HOST_GATEWAY;
export const CONTAINER_RUNTIME_BIN = detectContainerRuntime();

function detectContainerRuntime(): string {
  try {
    execSync('docker info', { timeout: 5000, stdio: 'pipe' });
    return 'docker';
  } catch {
    try {
      execSync('podman info', { timeout: 5000, stdio: 'pipe' });
      return 'podman';
    } catch {
      return 'docker';
    }
  }
}

export function hostGatewayArgs(): string[] {
  if (CONTAINER_RUNTIME_BIN === 'podman') {
    return ['--network=host'];
  }
  return ['--add-host', `${CONTAINER_HOST_GATEWAY}:host-gateway`];
}

export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

export function stopContainer(containerName: string): string {
  if (CONTAINER_RUNTIME_BIN === 'podman') {
    return `podman stop --time 15 ${containerName} 2>/dev/null || podman kill ${containerName} 2>/dev/null`;
  }
  return `docker stop --time 15 ${containerName} 2>/dev/null || docker kill ${containerName} 2>/dev/null`;
}

export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, { timeout: 5000, stdio: 'pipe' });
  } catch (err) {
    logger.error({ runtime: CONTAINER_RUNTIME_BIN, err }, 'Container runtime not available');
    throw new Error(`${CONTAINER_RUNTIME_BIN} is not running or accessible`);
  }
}

export function cleanupOrphans(): void {
  try {
    if (CONTAINER_RUNTIME_BIN === 'docker') {
      const result = execSync(
        `docker ps -a --filter "name=nanoclaw-" --format '{{.Names}} {{.Status}}'`,
        { timeout: 10000, encoding: 'utf-8' },
      );
      for (const line of result.trim().split('\n').filter(Boolean)) {
        const [name, ...statusParts] = line.split(' ');
        const status = statusParts.join(' ');
        if (status.includes('Exited') || status.includes('Created')) {
          logger.info({ container: name }, 'Removing orphaned container');
          try {
            execSync(`docker rm -f ${name}`, { timeout: 10000, stdio: 'pipe' });
          } catch {}
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
