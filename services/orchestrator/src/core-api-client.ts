/**
 * Core API Client — HTTP client for the orchestrator to talk to the monolith.
 *
 * Replaces direct SQLite access. The orchestrator calls the Core API
 * for all data operations: messages, sessions, state, groups, and sending.
 */
import { request as httpRequest } from 'http';

import { CORE_SERVICE_URL } from './config.js';
import { logger } from './logger.js';

// ─── Types ───

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
  isMain?: boolean;
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

// ─── Data API wrappers ───

export async function getRegisteredGroups(): Promise<
  Record<string, RegisteredGroup>
> {
  try {
    const data = await coreGet<{ groups: Record<string, { jid: string; name: string; folder: string }> }>(
      '/api/v1/groups/registered',
    );
    // Convert the response to RegisteredGroup format
    const result: Record<string, RegisteredGroup> = {};
    for (const [jid, g] of Object.entries(data.groups)) {
      result[jid] = {
        name: g.name,
        folder: g.folder,
        trigger: '@',
        added_at: '',
        isMain: false,
        requiresTrigger: true,
      };
    }
    return result;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch registered groups');
    return {};
  }
}

export async function getNewMessages(
  jids: string[],
  sinceTimestamp: string,
  assistantName: string,
): Promise<{ messages: NewMessage[]; newTimestamp: string }> {
  try {
    const jidsParam = jids.join(',');
    const data = await coreGet<{
      messages: NewMessage[];
      newTimestamp: string;
    }>(
      `/api/v1/messages/new?jids=${encodeURIComponent(jidsParam)}&since=${encodeURIComponent(sinceTimestamp)}&assistantName=${encodeURIComponent(assistantName)}`,
    );
    return data;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch new messages');
    return { messages: [], newTimestamp: sinceTimestamp };
  }
}

export async function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  assistantName: string,
): Promise<NewMessage[]> {
  try {
    const data = await coreGet<{ messages: NewMessage[] }>(
      `/api/v1/messages/since?chatJid=${encodeURIComponent(chatJid)}&since=${encodeURIComponent(sinceTimestamp)}&assistantName=${encodeURIComponent(assistantName)}`,
    );
    return data.messages || [];
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch messages since');
    return [];
  }
}

export async function getAllSessions(): Promise<Record<string, string>> {
  try {
    const data = await coreGet<{ sessions: Record<string, string> }>(
      '/api/v1/sessions',
    );
    return data.sessions || {};
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch sessions');
    return {};
  }
}

export async function setSession(
  groupFolder: string,
  sessionId: string,
): Promise<void> {
  try {
    await corePost('/api/v1/sessions', { groupFolder, sessionId });
  } catch (err) {
    logger.warn({ err, groupFolder }, 'Failed to set session');
  }
}

export async function getRouterState(key: string): Promise<string | null> {
  try {
    const data = await coreGet<{ value: string | null }>(
      `/api/v1/state?key=${encodeURIComponent(key)}`,
    );
    return data.value;
  } catch (err) {
    logger.warn({ err, key }, 'Failed to get router state');
    return null;
  }
}

export async function setRouterState(
  key: string,
  value: string,
): Promise<void> {
  try {
    await corePost('/api/v1/state', { key, value });
  } catch (err) {
    logger.warn({ err, key }, 'Failed to set router state');
  }
}

export async function sendMessage(
  jid: string,
  text: string,
): Promise<void> {
  try {
    await corePost('/api/v1/send', { jid, text });
    logger.info({ jid, length: text.length }, 'Message sent via Core API');
  } catch (err) {
    logger.error({ err, jid }, 'Failed to send message via Core API');
  }
}
