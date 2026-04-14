/**
 * Group Queue — Manages concurrent agent execution per group.
 *
 * Extracted from monolith's group-queue.ts.
 * Controls how many containers run simultaneously and queues work.
 */
import { ChildProcess } from 'child_process';
import { MAX_CONCURRENT_CONTAINERS } from './config.js';
import { logger } from './logger.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

interface GroupState {
  active: boolean;
  idleWaiting: boolean;
  isTaskContainer: boolean;
  runningTaskId: string | null;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        idleWaiting: false,
        isTaskContainer: false,
        runningTaskId: null,
        pendingMessages: false,
        pendingTasks: [],
        process: null,
        containerName: null,
        groupFolder: null,
        retryCount: 0,
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  registerProcess(
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    state.groupFolder = groupFolder;
  }

  sendMessage(groupJid: string, formatted: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.process || !state.active) return false;

    try {
      state.process.stdin?.write(formatted + '\n');
      return true;
    } catch {
      return false;
    }
  }

  closeStdin(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (state.process?.stdin && !state.process.stdin.destroyed) {
      state.process.stdin.end();
    }
  }

  notifyIdle(groupJid: string): void {
    const state = this.getGroup(groupJid);
    state.idleWaiting = true;

    // Check for pending work
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      state.idleWaiting = false;
      task.fn().catch((err) => {
        logger.error({ err, groupJid, taskId: task.id }, 'Task execution failed');
      });
      return;
    }

    if (state.pendingMessages && this.processMessagesFn) {
      state.pendingMessages = false;
      state.idleWaiting = false;
      this.processMessagesFn(groupJid).then((success) => {
        if (!success) {
          // Retry logic
          if (state.retryCount < 5) {
            state.retryCount++;
            state.pendingMessages = true;
          }
        } else {
          state.retryCount = 0;
        }
      });
    }
  }

  enqueueMessageCheck(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (state.active) {
      // Container is running — mark for processing when it goes idle
      state.pendingMessages = true;
      return;
    }

    // No active container — start a new one
    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      return;
    }

    this.startMessages(groupJid);
  }

  enqueueTask(
    groupJid: string,
    taskId: string,
    fn: () => Promise<void>,
  ): void {
    const state = this.getGroup(groupJid);
    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      return;
    }

    state.isTaskContainer = true;
    state.runningTaskId = taskId;
    state.active = true;
    this.activeCount++;
    fn().catch((err) => {
      logger.error({ err, groupJid, taskId }, 'Task failed');
    });
  }

  private startMessages(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (state.active) return;
    if (!this.processMessagesFn) return;

    state.active = true;
    state.isTaskContainer = false;
    state.runningTaskId = null;
    this.activeCount++;

    this.processMessagesFn(groupJid).then((success) => {
      // processGroupMessages calls onOutput → notifyIdle when done
      if (!success) {
        // Error — release the slot
        this.releaseSlot(groupJid);
      }
    }).catch(() => {
      this.releaseSlot(groupJid);
    });
  }

  releaseSlot(groupJid: string): void {
    const state = this.getGroup(groupJid);
    state.active = false;
    state.process = null;
    state.containerName = null;
    state.idleWaiting = false;
    state.isTaskContainer = false;
    state.runningTaskId = null;
    this.activeCount--;

    // Start next waiting group
    if (this.waitingGroups.length > 0) {
      const next = this.waitingGroups.shift()!;
      const nextState = this.getGroup(next);
      if (nextState.pendingTasks.length > 0) {
        const task = nextState.pendingTasks.shift()!;
        this.enqueueTask(next, task.id, task.fn);
      } else {
        this.startMessages(next);
      }
    }
  }

  async shutdown(timeoutMs: number): Promise<void> {
    this.shuttingDown = true;
    // Graceful shutdown would send SIGTERM to all active containers
  }

  getStats(): { active: number; waiting: number; total: number } {
    return {
      active: this.activeCount,
      waiting: this.waitingGroups.length,
      total: this.groups.size,
    };
  }
}
