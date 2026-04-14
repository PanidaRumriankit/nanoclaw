/**
 * WhatsApp Connection Manager
 *
 * Extracted from src/channels/whatsapp.ts — manages Baileys socket lifecycle,
 * message reception, and outbound delivery.
 *
 * Differences from the monolith version:
 * - Messages are pushed upstream via HTTP (not direct callbacks)
 * - Registered groups are fetched from Core Service via API Gateway
 * - No dependency on monolith modules (config, db, metrics)
 */
import { exec } from 'child_process';
import fs from 'fs';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  WASocket,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  AUTH_DIR,
  GROUP_SYNC_INTERVAL_MS,
} from './config.js';
import { logger } from './logger.js';
import {
  pushInboundMessage,
  pushChatMetadata,
  fetchRegisteredGroups,
} from './upstream.js';

let sock: WASocket;
let connected = false;
let lidToPhoneMap: Record<string, string> = {};
let outgoingQueue: Array<{ jid: string; text: string }> = [];
let flushing = false;
let groupSyncTimerStarted = false;

// Cache of registered groups, refreshed periodically from Core
let registeredGroupsCache: Record<
  string,
  { jid: string; name: string; folder: string }
> = {};
let groupsCacheTimer: ReturnType<typeof setInterval> | null = null;

export function isConnected(): boolean {
  return connected;
}

export function getSocket(): WASocket {
  return sock;
}

/**
 * Connect to WhatsApp via Baileys.
 * Returns a promise that resolves on first successful connection.
 */
export async function connectWhatsApp(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    connectInternal(resolve).catch(reject);
  });
}

async function connectInternal(onFirstOpen?: () => void): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
    logger.warn(
      { err },
      'Failed to fetch latest WA Web version, using default',
    );
    return { version: undefined };
  });

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Chrome'),
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const msg =
        'WhatsApp authentication required. Run auth process on host.';
      logger.error(msg);
      exec(
        `osascript -e 'display notification "${msg}" with title "NanoClaw WhatsApp Gateway" sound name "Basso"'`,
      );
      setTimeout(() => process.exit(1), 1000);
    }

    if (connection === 'close') {
      connected = false;
      const reason = (
        lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      logger.info(
        {
          reason,
          shouldReconnect,
          queuedMessages: outgoingQueue.length,
        },
        'Connection closed',
      );

      if (shouldReconnect) {
        logger.info('Reconnecting...');
        connectInternal().catch((err) => {
          logger.error({ err }, 'Failed to reconnect, retrying in 5s');
          setTimeout(() => {
            connectInternal().catch((err2) => {
              logger.error({ err: err2 }, 'Reconnection retry failed');
            });
          }, 5000);
        });
      } else {
        logger.info('Logged out. Run auth process to re-authenticate.');
        process.exit(0);
      }
    } else if (connection === 'open') {
      connected = true;
      logger.info('Connected to WhatsApp');

      sock.sendPresenceUpdate('available').catch((err) => {
        logger.warn({ err }, 'Failed to send presence update');
      });

      // Build LID→phone mapping
      if (sock.user) {
        const phoneUser = sock.user.id.split(':')[0];
        const lidUser = sock.user.lid?.split(':')[0];
        if (lidUser && phoneUser) {
          lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
          logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
        }
      }

      // Flush queued messages
      flushOutgoingQueue().catch((err) =>
        logger.error({ err }, 'Failed to flush outgoing queue'),
      );

      // Sync group metadata on startup
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Initial group sync failed'),
      );

      // Set up periodic sync
      if (!groupSyncTimerStarted) {
        groupSyncTimerStarted = true;
        setInterval(() => {
          syncGroupMetadata().catch((err) =>
            logger.error({ err }, 'Periodic group sync failed'),
          );
        }, GROUP_SYNC_INTERVAL_MS);
      }

      // Start periodic registered groups cache refresh
      if (!groupsCacheTimer) {
        refreshGroupsCache();
        groupsCacheTimer = setInterval(refreshGroupsCache, 30_000); // every 30s
      }

      // Signal first connection
      if (onFirstOpen) {
        onFirstOpen();
        onFirstOpen = undefined;
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const normalized = normalizeMessageContent(msg.message);
        if (!normalized) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        const chatJid = await translateJid(rawJid);
        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();

        // Push chat metadata upstream (non-blocking)
        const isGroup = chatJid.endsWith('@g.us');
        pushChatMetadata({
          chatJid,
          timestamp,
          channel: 'whatsapp',
          isGroup,
        });

        // Only deliver full messages for registered groups
        if (registeredGroupsCache[chatJid]) {
          const content =
            normalized.conversation ||
            normalized.extendedTextMessage?.text ||
            normalized.imageMessage?.caption ||
            normalized.videoMessage?.caption ||
            '';

          if (!content) continue;

          const sender = msg.key.participant || msg.key.remoteJid || '';
          const senderName = msg.pushName || sender.split('@')[0];
          const fromMe = msg.key.fromMe || false;
          const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
            ? fromMe
            : content.startsWith(`${ASSISTANT_NAME}:`);

          // Push message upstream (non-blocking)
          pushInboundMessage({
            id: msg.key.id || '',
            chatJid,
            sender,
            senderName,
            content,
            timestamp,
            isFromMe: fromMe,
            isBotMessage,
            channel: 'whatsapp',
          });
        }
      } catch (err) {
        logger.error(
          { err, remoteJid: msg.key?.remoteJid },
          'Error processing incoming message',
        );
      }
    }
  });
}

/**
 * Send a message via WhatsApp.
 */
export async function sendMessage(jid: string, text: string): Promise<void> {
  const prefixed = ASSISTANT_HAS_OWN_NUMBER
    ? text
    : `${ASSISTANT_NAME}: ${text}`;

  if (!connected) {
    outgoingQueue.push({ jid, text: prefixed });
    logger.info(
      { jid, length: prefixed.length, queueSize: outgoingQueue.length },
      'WA disconnected, message queued',
    );
    return;
  }

  try {
    await sock.sendMessage(jid, { text: prefixed });
    logger.info({ jid, length: prefixed.length }, 'Message sent');
  } catch (err) {
    outgoingQueue.push({ jid, text: prefixed });
    logger.warn(
      { jid, err, queueSize: outgoingQueue.length },
      'Failed to send, message queued',
    );
  }
}

/**
 * Set typing indicator.
 */
export async function setTyping(
  jid: string,
  isTyping: boolean,
): Promise<void> {
  try {
    const status = isTyping ? 'composing' : 'paused';
    await sock.sendPresenceUpdate(status, jid);
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to update typing status');
  }
}

/**
 * Join a group via invite link/code.
 */
export async function joinGroup(invite: string): Promise<string> {
  const inviteCode = invite.includes('chat.whatsapp.com/')
    ? invite.split('chat.whatsapp.com/')[1].split('/')[0].split('?')[0]
    : invite.split('?')[0];

  const jid = await sock.groupAcceptInvite(inviteCode);
  if (jid) {
    logger.info({ jid, inviteCode }, 'Joined group via invite code');
    await syncGroupMetadata(true);
    return jid;
  }
  throw new Error('Failed to join group (no JID returned)');
}

/**
 * Sync group metadata from WhatsApp.
 */
export async function syncGroupMetadata(force = false): Promise<number> {
  try {
    logger.info('Syncing group metadata from WhatsApp...');
    const groups = await sock.groupFetchAllParticipating();

    let count = 0;
    for (const [jid, metadata] of Object.entries(groups)) {
      if (metadata.subject) {
        // Push metadata upstream to Core
        pushChatMetadata({
          chatJid: jid,
          timestamp: new Date().toISOString(),
          name: metadata.subject,
          channel: 'whatsapp',
          isGroup: true,
        });
        count++;
      }
    }

    logger.info({ count }, 'Group metadata synced');
    return count;
  } catch (err) {
    logger.error({ err }, 'Failed to sync group metadata');
    return 0;
  }
}

async function translateJid(jid: string): Promise<string> {
  if (!jid.endsWith('@lid')) return jid;
  const lidUser = jid.split('@')[0].split(':')[0];

  const cached = lidToPhoneMap[lidUser];
  if (cached) return cached;

  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid);
    if (pn) {
      const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
      lidToPhoneMap[lidUser] = phoneJid;
      logger.info({ lidJid: jid, phoneJid }, 'Translated LID to phone JID');
      return phoneJid;
    }
  } catch (err) {
    logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
  }

  return jid;
}

async function flushOutgoingQueue(): Promise<void> {
  if (flushing || outgoingQueue.length === 0) return;
  flushing = true;
  try {
    logger.info(
      { count: outgoingQueue.length },
      'Flushing outgoing message queue',
    );
    while (outgoingQueue.length > 0) {
      const item = outgoingQueue.shift()!;
      await sock.sendMessage(item.jid, { text: item.text });
      logger.info(
        { jid: item.jid, length: item.text.length },
        'Queued message sent',
      );
    }
  } finally {
    flushing = false;
  }
}

function refreshGroupsCache(): void {
  fetchRegisteredGroups()
    .then((groups) => {
      registeredGroupsCache = groups;
      logger.debug(
        { count: Object.keys(groups).length },
        'Registered groups cache refreshed',
      );
    })
    .catch((err) => {
      logger.warn({ err }, 'Failed to refresh registered groups cache');
    });
}
