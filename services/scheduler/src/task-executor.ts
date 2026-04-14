/**
 * Task Executor — Runs scheduled tasks via the Core API.
 *
 * Checks for due tasks via Core API, notifies the Orchestrator to execute them,
 * and reports results back via Core API.
 */
import { CronExpressionParser } from 'cron-parser';
import { request as httpRequest } from 'http';

import {
  ORCHESTRATOR_URL,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import {
  getDueTasks,
  updateTask,
  updateTaskAfterRun,
  logTaskRun,
  ScheduledTask,
} from './core-api-client.js';
import { logger } from './logger.js';

/**
 * Compute the next run time for a recurring task.
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    try {
      const interval = CronExpressionParser.parse(task.schedule_value, {
        tz: TIMEZONE,
      });
      return interval.next().toISOString();
    } catch (err) {
      logger.warn(
        { taskId: task.id, value: task.schedule_value, err },
        'Invalid cron expression',
      );
      return null;
    }
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

/**
 * Notify the Orchestrator to process a group's messages.
 */
async function notifyOrchestrator(chatJid: string): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(ORCHESTRATOR_URL);
    const payload = JSON.stringify({ chatJid });

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/api/v1/orchestrator/process',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      (res) => {
        res.resume();
        resolve();
      },
    );

    req.on('error', (err) => {
      logger.warn({ err, chatJid }, 'Failed to notify orchestrator');
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Execute a scheduled task.
 */
async function executeTask(task: ScheduledTask): Promise<void> {
  const startTime = Date.now();
  let result: string | null = null;
  let error: string | null = null;

  logger.info(
    { taskId: task.id, group: task.group_folder, type: task.schedule_type },
    'Executing scheduled task',
  );

  try {
    await notifyOrchestrator(task.chat_jid);
    result = 'Triggered orchestrator for group processing';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task execution failed');
  }

  const durationMs = Date.now() - startTime;

  // Report results via Core API
  await logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  await updateTaskAfterRun(task.id, nextRun, resultSummary);

  logger.info({ taskId: task.id, durationMs, nextRun }, 'Task completed');
}

// ─── Scheduler Loop ───

let schedulerRunning = false;

export function startSchedulerLoop(): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running');
    return;
  }
  schedulerRunning = true;
  logger.info({ interval: SCHEDULER_POLL_INTERVAL }, 'Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = await getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        if (task.status !== 'active') continue;
        await executeTask(task);
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
