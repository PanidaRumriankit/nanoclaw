/**
 * Core API Client — HTTP client for the scheduler to talk to the monolith.
 *
 * Replaces direct SQLite access. The scheduler calls the Core API
 * for task queries and updates.
 */
import { request as httpRequest } from 'http';

import { CORE_SERVICE_URL } from './config.js';
import { logger } from './logger.js';

// ─── Types ───

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

// ─── HTTP helpers ───

function coreUrl(path: string): string {
  return `${CORE_SERVICE_URL}${path}`;
}

async function coreGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(coreUrl(path));
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { accept: 'application/json' },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (err) {
            reject(new Error(`Failed to parse response from ${path}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET ${path} timed out`));
    });
    req.end();
  });
}

async function corePost<T>(path: string, body: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(coreUrl(path));
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve({} as T);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`POST ${path} timed out`));
    });
    req.write(payload);
    req.end();
  });
}

// ─── Task API wrappers ───

export async function getDueTasks(): Promise<ScheduledTask[]> {
  try {
    const data = await coreGet<{ tasks: ScheduledTask[] }>(
      '/api/v1/tasks/due',
    );
    return data.tasks || [];
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch due tasks');
    return [];
  }
}

export async function getAllTasks(): Promise<ScheduledTask[]> {
  try {
    const data = await coreGet<{ tasks: ScheduledTask[] }>(
      '/api/v1/tasks',
    );
    return data.tasks || [];
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch tasks');
    return [];
  }
}

export async function updateTask(
  id: string,
  updates: Record<string, unknown>,
): Promise<void> {
  try {
    await corePost(`/api/v1/tasks/${id}/update`, { updates });
  } catch (err) {
    logger.warn({ err, taskId: id }, 'Failed to update task');
  }
}

export async function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  resultSummary: string,
): Promise<void> {
  try {
    await corePost(`/api/v1/tasks/${id}/after-run`, {
      nextRun,
      resultSummary,
    });
  } catch (err) {
    logger.warn({ err, taskId: id }, 'Failed to update task after run');
  }
}

export async function logTaskRun(log: {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}): Promise<void> {
  try {
    await corePost('/api/v1/tasks/log', log);
  } catch (err) {
    logger.warn({ err, taskId: log.task_id }, 'Failed to log task run');
  }
}
