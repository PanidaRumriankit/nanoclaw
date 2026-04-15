/**
 * Container Runner — Spawns agent containers and handles IPC.
 *
 * Extracted from monolith's container-runner.ts.
 * Runs as a stateless service: receives input, spawns container, returns output.
 */
import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ANTHROPIC_DEFAULT_HAIKU_MODEL,
  ANTHROPIC_DEFAULT_OPUS_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL,
  CLAUDE_CODE_MODEL,
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  CREDENTIAL_PROXY_PORT,
  IDLE_TIMEOUT,
  PROJECT_ROOT,
  TIMEZONE,
} from './config.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  CONTAINER_HOST_GATEWAY,
  CONTAINER_RUNTIME_BIN,
  hostGatewayArgs,
  readonlyMountArgs,
  stopContainer,
} from './container-runtime.js';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

interface GroupInfo {
  name: string;
  folder: string;
  isMain?: boolean;
}

function buildVolumeMounts(group: GroupInfo, isMain: boolean, containerName: string): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const groupDir = resolveGroupFolderPath(group.folder);

  if (isMain) {
    mounts.push({ hostPath: PROJECT_ROOT, containerPath: '/workspace/project', readonly: true });
    const envFile = path.join(PROJECT_ROOT, '.env');
    if (fs.existsSync(envFile)) {
      mounts.push({ hostPath: '/dev/null', containerPath: '/workspace/project/.env', readonly: true });
    }
    mounts.push({ hostPath: groupDir, containerPath: '/workspace/group', readonly: false });
  } else {
    mounts.push({ hostPath: groupDir, containerPath: '/workspace/group', readonly: false });
    const globalDir = path.join(PROJECT_ROOT, 'groups', 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({ hostPath: globalDir, containerPath: '/workspace/global', readonly: true });
    }
  }

  // Per-group Claude sessions
  const groupSessionsDir = path.join(PROJECT_ROOT, 'data', 'sessions', group.folder, '.claude');
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      },
    }, null, 2) + '\n');
  }

  const skillsSrc = path.join(PROJECT_ROOT, 'container', 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      fs.cpSync(srcDir, path.join(groupSessionsDir, 'skills', skillDir), { recursive: true });
    }
  }
  mounts.push({ hostPath: groupSessionsDir, containerPath: '/home/node/.claude', readonly: false });

  // IPC
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({ hostPath: groupIpcDir, containerPath: '/workspace/ipc', readonly: false });

  // Agent runner source
  const agentRunnerSrc = path.join(PROJECT_ROOT, 'container', 'agent-runner', 'src');
  const groupAgentRunnerDir = path.join(PROJECT_ROOT, 'data', 'sessions', group.folder, 'agent-runner-src');
  if (fs.existsSync(agentRunnerSrc)) {
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true, force: true });
  }
  mounts.push({ hostPath: groupAgentRunnerDir, containerPath: '/app/src', readonly: false });

  // Unique /tmp
  const runTmpDir = path.join(PROJECT_ROOT, 'data', 'tmp', containerName);
  fs.mkdirSync(runTmpDir, { recursive: true });
  mounts.push({ hostPath: runTmpDir, containerPath: '/tmp', readonly: false });

  return mounts;
}

function buildContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];
  args.push('-e', `TZ=${TIMEZONE}`);
  args.push('-e', `ANTHROPIC_BASE_URL=http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`);
  args.push('-e', 'ANTHROPIC_API_KEY=placeholder');
  args.push(...hostGatewayArgs());

  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  if (CLAUDE_CODE_MODEL) args.push('-e', `CLAUDE_CODE_MODEL=${CLAUDE_CODE_MODEL}`);
  if (ANTHROPIC_DEFAULT_HAIKU_MODEL) args.push('-e', `ANTHROPIC_DEFAULT_HAIKU_MODEL=${ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
  if (ANTHROPIC_DEFAULT_SONNET_MODEL) args.push('-e', `ANTHROPIC_DEFAULT_SONNET_MODEL=${ANTHROPIC_DEFAULT_SONNET_MODEL}`);
  if (ANTHROPIC_DEFAULT_OPUS_MODEL) args.push('-e', `ANTHROPIC_DEFAULT_OPUS_MODEL=${ANTHROPIC_DEFAULT_OPUS_MODEL}`);

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }
  args.push(CONTAINER_IMAGE);
  return args;
}

export async function runContainerAgent(group: GroupInfo, input: ContainerInput): Promise<ContainerOutput> {
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const mounts = buildVolumeMounts(group, input.isMain, containerName);
  const containerArgs = buildContainerArgs(mounts, containerName);

  logger.info({ group: group.name, containerName, mountCount: mounts.length, isMain: input.isMain }, 'Spawning container');

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let containerActive = true;
    const finish = () => { containerActive = false; };

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let hadStreamingOutput = false;
    let finalResult: string | null = null;

    container.stdout.on('data', (data) => {
      const chunk = data.toString();
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) { stdout += chunk.slice(0, remaining); stdoutTruncated = true; }
        else { stdout += chunk; }
      }

      parseBuffer += chunk;
      let startIdx: number;
      while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
        const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
        if (endIdx === -1) break;
        const jsonStr = parseBuffer.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);
        try {
          const parsed: ContainerOutput = JSON.parse(jsonStr);
          if (parsed.newSessionId) newSessionId = parsed.newSessionId;
          hadStreamingOutput = true;
          resetTimeout();
          if (parsed.result) finalResult = parsed.result;
        } catch (err) {
          logger.warn({ group: group.name, err }, 'Failed to parse output chunk');
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      for (const line of chunk.trim().split('\n')) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) { stderr += chunk.slice(0, remaining); stderrTruncated = true; }
      else { stderr += chunk; }
    });

    let timedOut = false;
    const timeoutMs = Math.max(CONTAINER_TIMEOUT, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, containerName }, 'Container timeout');
      exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
        if (err) container.kill('SIGKILL');
      });
    };

    let timeout: ReturnType<typeof setTimeout> = setTimeout(killOnTimeout, timeoutMs);
    const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(killOnTimeout, timeoutMs); };

    container.on('close', (code) => {
      finish();
      clearTimeout(timeout);
      outputChain.then(() => {
        if (timedOut) {
          resolve({ status: 'error', result: null, error: 'Container timed out' });
        } else if (newSessionId) {
          resolve({ status: 'success', result: hadStreamingOutput ? finalResult : (stdout.trim() || null), newSessionId });
        } else if (code === 0) {
          resolve({ status: 'success', result: stdout.trim() || null });
        } else {
          resolve({ status: 'error', result: null, error: stderr.trim() || `Exit code ${code}` });
        }
      });
    });

    container.on('error', (err) => {
      finish();
      clearTimeout(timeout);
      resolve({ status: 'error', result: null, error: err.message });
    });
  });
}
