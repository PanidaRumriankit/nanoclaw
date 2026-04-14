/**
 * API Channel — A Channel implementation that routes through the API Gateway.
 *
 * Instead of directly connecting to WhatsApp via Baileys, this channel
 * sends outbound messages via HTTP to the API Gateway, which forwards
 * them to the WhatsApp Gateway.
 *
 * Inbound messages arrive via the Core API Server (core-api-server.ts),
 * not through this channel. This channel is purely for outbound operations.
 */
import { request as httpRequest, RequestOptions } from 'http';

import type {
  OutboundMessageRequest,
  TypingRequest,
  GroupSyncRequest,
  GroupJoinRequest,
} from './service-contracts.js';

import { logger } from './logger.js';
import { Channel } from './types.js';
import { recordSentMessage, recordError } from './metrics.js';

export interface ApiChannelConfig {
  /** URL of the API Gateway */
  apiGatewayUrl: string;
  /** JID suffixes this channel claims ownership of */
  jidSuffixes: string[];
}

function postJson(
  baseUrl: string,
  path: string,
  body: object,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
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
      timeout: 30000,
    };

    const req = httpRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 500,
          data: Buffer.concat(chunks).toString(),
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${path} timed out`));
    });

    req.write(payload);
    req.end();
  });
}

function checkHealth(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(baseUrl);

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/health',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Create an API Channel that routes messages through the API Gateway.
 */
export class ApiChannel implements Channel {
  name = 'api-gateway';
  private config: ApiChannelConfig;
  private _connected = false;

  constructor(config: ApiChannelConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Check if the API Gateway is reachable
    const healthy = await checkHealth(this.config.apiGatewayUrl);
    this._connected = healthy;
    if (healthy) {
      logger.info(
        { url: this.config.apiGatewayUrl },
        'API Channel connected to gateway',
      );
    } else {
      logger.warn(
        { url: this.config.apiGatewayUrl },
        'API Channel: gateway not reachable, will retry on first message',
      );
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const body: OutboundMessageRequest = { chatJid: jid, text };
    try {
      const result = await postJson(
        this.config.apiGatewayUrl,
        '/api/v1/messages/outbound',
        body,
      );
      if (result.status >= 200 && result.status < 300) {
        this._connected = true;
        recordSentMessage();
        logger.info({ jid, length: text.length }, 'Message sent via API Gateway');
      } else {
        logger.error(
          { jid, status: result.status, body: result.data },
          'API Gateway returned error for outbound message',
        );
        recordError();
        throw new Error(`API Gateway error: ${result.status}`);
      }
    } catch (err) {
      this._connected = false;
      recordError();
      logger.error({ err, jid }, 'Failed to send message via API Gateway');
      throw err;
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  ownsJid(jid: string): boolean {
    return this.config.jidSuffixes.some((suffix) => jid.endsWith(suffix));
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const body: TypingRequest = { chatJid: jid, isTyping };
    try {
      await postJson(this.config.apiGatewayUrl, '/api/v1/typing', body);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to set typing via API Gateway');
    }
  }

  async syncGroups(force: boolean): Promise<void> {
    const body: GroupSyncRequest = { force };
    try {
      await postJson(this.config.apiGatewayUrl, '/api/v1/groups/sync', body);
      logger.info('Group sync triggered via API Gateway');
    } catch (err) {
      logger.error({ err }, 'Failed to trigger group sync via API Gateway');
    }
  }

  async joinGroup(inviteCode: string): Promise<string> {
    const body: GroupJoinRequest = { invite: inviteCode };
    const result = await postJson(
      this.config.apiGatewayUrl,
      '/api/v1/groups/join',
      body,
    );
    const parsed = JSON.parse(result.data);
    if (parsed.ok && parsed.jid) {
      logger.info({ jid: parsed.jid }, 'Joined group via API Gateway');
      return parsed.jid;
    }
    throw new Error(parsed.error || 'Failed to join group via API Gateway');
  }
}
