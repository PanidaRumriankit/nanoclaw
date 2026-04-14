/**
 * Orchestrator — Core message processing and agent routing logic.
 *
 * Uses Core API (monolith) for all data operations instead of direct DB access.
 * Owns: message loop, agent execution, container lifecycle, queue management.
 */
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  POLL_INTERVAL,
  PROJECT_ROOT,
  TIMEZONE,
} from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getRegisteredGroups,
  getNewMessages,
  getMessagesSince,
  getAllSessions,
  setSession as setSessionApi,
  getRouterState,
  setRouterState,
  sendMessage,
  NewMessage,
  RegisteredGroup,
} from './core-api-client.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';

// ─── State ───

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const queue = new GroupQueue();

// ─── Trigger pattern ───

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTriggerPattern(): RegExp {
  return new RegExp(`^@${escapeRegex(ASSISTANT_NAME)}\\b`, 'i');
}

// ─── Message formatting ───

function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLocalTime(isoTimestamp: string, timezone: string): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoTimestamp;
  }
}

function formatMessages(messages: NewMessage[], timezone: string): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;
  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

// ─── Outbound text formatting ───

function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

function formatOutbound(rawText: string): string {
  return stripInternalTags(rawText);
}

// ─── State management (via Core API) ───

export async function loadState(): Promise<void> {
  lastTimestamp = (await getRouterState('last_timestamp')) || '';
  const agentTs = await getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp, resetting');
    lastAgentTimestamp = {};
  }
  sessions = await getAllSessions();
  registeredGroups = await getRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded from Core API',
  );
}

async function saveState(): Promise<void> {
  await setRouterState('last_timestamp', lastTimestamp);
  await setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

export function getRegisteredGroupsLocal(): Record<string, RegisteredGroup> {
  return registeredGroups;
}

export function getQueue(): GroupQueue {
  return queue;
}

// ─── Agent execution ───

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  let status: 'success' | 'error' = 'error';
  const isMain = group.isMain === true;
  const sessionId = sessions[group.folder];

  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          await setSessionApi(group.folder, output.newSessionId);
        }
        if (output.status === 'error') {
          status = 'error';
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      { name: group.name, folder: group.folder, isMain: group.isMain },
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      await setSessionApi(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      status = 'error';
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    status = 'success';
    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

// ─── Message processing per group ───

async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.isMain === true;
  const TRIGGER_PATTERN = getTriggerPattern();

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = await getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);

  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  await saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        // Send via Core API → channel
        await sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback',
      );
      return true;
    }
    lastAgentTimestamp[chatJid] = previousCursor;
    await saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

// ─── Message loop ───

export function startMessageLoop(): void {
  if (messageLoopRunning) {
    logger.debug('Message loop already running');
    return;
  }
  messageLoopRunning = true;
  logger.info(`Orchestrator running (trigger: @${ASSISTANT_NAME})`);

  queue.setProcessMessagesFn(processGroupMessages);

  const loop = async () => {
    while (true) {
      try {
        const jids = Object.keys(registeredGroups);
        const { messages, newTimestamp } = await getNewMessages(
          jids,
          lastTimestamp,
          ASSISTANT_NAME,
        );

        if (messages.length > 0) {
          logger.info({ count: messages.length }, 'New messages');
          lastTimestamp = newTimestamp;
          await saveState();

          const messagesByGroup = new Map<string, NewMessage[]>();
          for (const msg of messages) {
            const existing = messagesByGroup.get(msg.chat_jid);
            if (existing) {
              existing.push(msg);
            } else {
              messagesByGroup.set(msg.chat_jid, [msg]);
            }
          }

          const TRIGGER_PATTERN = getTriggerPattern();

          for (const [chatJid, groupMessages] of messagesByGroup) {
            const group = registeredGroups[chatJid];
            if (!group) continue;

            const isMainGroup = group.isMain === true;
            const needsTrigger =
              !isMainGroup && group.requiresTrigger !== false;

            if (needsTrigger) {
              const hasTrigger = groupMessages.some((m) =>
                TRIGGER_PATTERN.test(m.content.trim()),
              );
              if (!hasTrigger) continue;
            }

            const allPending = await getMessagesSince(
              chatJid,
              lastAgentTimestamp[chatJid] || '',
              ASSISTANT_NAME,
            );
            const messagesToSend =
              allPending.length > 0 ? allPending : groupMessages;
            const formatted = formatMessages(messagesToSend, TIMEZONE);

            if (queue.sendMessage(chatJid, formatted)) {
              logger.debug(
                { chatJid, count: messagesToSend.length },
                'Piped messages to active container',
              );
              lastAgentTimestamp[chatJid] =
                messagesToSend[messagesToSend.length - 1].timestamp;
              await saveState();
            } else {
              queue.enqueueMessageCheck(chatJid);
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Error in message loop');
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  };

  loop();
}

// ─── Recovery ───

export async function recoverPendingMessages(): Promise<void> {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = await getMessagesSince(
      chatJid,
      sinceTimestamp,
      ASSISTANT_NAME,
    );
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}
