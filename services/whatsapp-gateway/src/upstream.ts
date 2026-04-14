/**
 * HTTP client to push inbound messages/metadata to the API Gateway.
 *
 * The WhatsApp Gateway receives messages from Baileys and forwards
 * them upstream to the Core Service via the API Gateway.
 */
import { request as httpRequest, RequestOptions } from 'http';

import type {
  InboundMessageRequest,
  ChatMetadataRequest,
} from './contracts.js';

import { API_GATEWAY_URL } from './config.js';
import { logger } from './logger.js';

function postJson(path: string, body: object): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = new URL(API_GATEWAY_URL);
    const payload = JSON.stringify(body);

    const options: RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = httpRequest(options, (res) => {
      // Consume response body to free socket
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        const err = new Error(
          `Upstream returned ${res.statusCode} for ${path}`,
        );
        logger.warn({ path, status: res.statusCode }, err.message);
        reject(err);
      }
    });

    req.on('error', (err) => {
      logger.error({ err, path }, 'Failed to send upstream request');
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Push an inbound WhatsApp message to the API Gateway → Core Service.
 */
export async function pushInboundMessage(
  msg: InboundMessageRequest,
): Promise<void> {
  try {
    await postJson('/api/v1/messages/inbound', msg);
    logger.debug(
      { chatJid: msg.chatJid, id: msg.id },
      'Inbound message pushed upstream',
    );
  } catch {
    // Non-fatal: message will be retried by the polling loop in Core
    logger.warn(
      { chatJid: msg.chatJid, id: msg.id },
      'Failed to push inbound message, Core will recover via DB poll',
    );
  }
}

/**
 * Push chat metadata to the API Gateway → Core Service.
 */
export async function pushChatMetadata(
  meta: ChatMetadataRequest,
): Promise<void> {
  try {
    await postJson('/api/v1/chat-metadata', meta);
  } catch {
    // Non-fatal
    logger.debug(
      { chatJid: meta.chatJid },
      'Failed to push chat metadata upstream',
    );
  }
}

/**
 * Fetch registered groups from the Core Service via API Gateway.
 */
export async function fetchRegisteredGroups(): Promise<
  Record<string, { jid: string; name: string; folder: string }>
> {
  return new Promise((resolve, reject) => {
    const url = new URL(API_GATEWAY_URL);

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/api/v1/groups/registered',
        method: 'GET',
        headers: { accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve(data.groups || {});
          } catch {
            resolve({});
          }
        });
      },
    );

    req.on('error', () => resolve({}));
    req.on('timeout', () => {
      req.destroy();
      resolve({});
    });
    req.end();
  });
}
