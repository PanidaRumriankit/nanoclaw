/**
 * Container Runtime — Docker/Podman abstraction for running agent containers.
 *
 * Extracted from monolith's container-runtime.ts.
 * The orchestrator needs Docker socket access to spawn containers.
 */
import { execSync } from 'child_process';
import { HOST_GATEWAY } from './config.js';
import { logger } from './logger.js';

/** Resolve the host gateway IP for containers to reach host services */
export const CONTAINER_HOST_GATEWAY = HOST_GATEWAY;

/** Detect container runtime (Docker or Podman) */
export const CONTAINER_RUNTIME_BIN = detectContainerRuntime();

function detectContainerRuntime(): string {
  // Check DOCKER_HOST env var first (explicit override)
  if (process.env.DOCKER_HOST) {
    try {
      execSync('docker info', { timeout: 5000, stdio: 'pipe' });
      return 'docker';
    } catch {
      // Fall through
    }
  }

  // Try docker
  try {
    execSync('docker info', { timeout: 5000, stdio: 'pipe' });
    return 'docker';
  } catch {
    // Fall through
  }

  // Try podman
  try {
    execSync('podman info', { timeout: 5000, stdio: 'pipe' });
    return 'podman';
  } catch {
    // Default to docker
    return 'docker';
  }
}

/** Args to add host.docker.internal mapping */
export function hostGatewayArgs(): string[] {
  if (CONTAINER_RUNTIME_BIN === 'podman') {
    return ['--network=host'];
  }
  return ['--add-host', `${CONTAINER_HOST_GATEWAY}:host-gateway`];
}

/** Args for read-only volume mounts */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Stop a container gracefully, then force kill */
export function stopContainer(containerName: string): string {
  if (CONTAINER_RUNTIME_BIN === 'podman') {
    return `podman stop --time 15 ${containerName} 2>/dev/null || podman kill ${containerName} 2>/dev/null`;
  }
  return `docker stop --time 15 ${containerName} 2>/dev/null || docker kill ${containerName} 2>/dev/null`;
}

/** Ensure the container runtime is running */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, { timeout: 5000, stdio: 'pipe' });
  } catch (err) {
    logger.error(
      { runtime: CONTAINER_RUNTIME_BIN, err },
      'Container runtime not available',
    );
    throw new Error(`${CONTAINER_RUNTIME_BIN} is not running or accessible`);
  }
}

/** Clean up orphaned containers */
export function cleanupOrphans(): void {
  try {
    const prefix = 'nanoclaw-';
    if (CONTAINER_RUNTIME_BIN === 'docker') {
      const result = execSync(
        `docker ps -a --filter "name=${prefix}" --format '{{.Names}} {{.Status}}'`,
        { timeout: 10000, encoding: 'utf-8' },
      );
      for (const line of result.trim().split('\n').filter(Boolean)) {
        const [name, ...statusParts] = line.split(' ');
        const status = statusParts.join(' ');
        if (status.includes('Exited') || status.includes('Created')) {
          logger.info({ container: name }, 'Removing orphaned container');
          try {
            execSync(`docker rm -f ${name}`, { timeout: 10000, stdio: 'pipe' });
          } catch {
            // Ignore removal errors
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
