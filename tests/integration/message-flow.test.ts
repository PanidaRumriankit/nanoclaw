/**
 * Integration Test: Message Flow
 *
 * Verifies the end-to-end message routing through the decomposed services:
 * 1. Simulated WhatsApp Gateway → API Gateway → Core Service (inbound)
 * 2. Core Service → API Gateway → Simulated WhatsApp Gateway (outbound)
 *
 * This test runs without Docker by creating in-process HTTP servers
 * that simulate the API Gateway routing behavior.
 */
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { request as httpRequest } from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ─── Test helpers ───

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function postJson(
  port: number,
  path: string,
  body: object,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 500,
            data: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(
  port: number,
  path: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 500,
            data: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ─── Mock Services ───

/** Captured messages for assertion */
interface CapturedMessage {
  path: string;
  body: Record<string, unknown>;
}

describe('Service Mesh: Message Flow', () => {
  let mockCoreServer: Server;
  let mockWhatsAppGatewayServer: Server;
  let mockApiGatewayServer: Server;

  const corePort = 14001;
  const waGatewayPort = 14002;
  const apiGatewayPort = 14000;

  const capturedByCore: CapturedMessage[] = [];
  const capturedByWaGateway: CapturedMessage[] = [];

  beforeAll(async () => {
    // Mock Core Service - captures inbound messages
    mockCoreServer = createServer(async (req, res) => {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      capturedByCore.push({ path: req.url || '', body: parsed });

      if (req.url === '/api/v1/groups/registered') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            groups: {
              '1234@g.us': {
                jid: '1234@g.us',
                name: 'Test Group',
                folder: 'test-group',
              },
            },
          }),
        );
        return;
      }

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'core-service',
            status: 'healthy',
            uptime: 100,
            dependencies: [],
          }),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    // Mock WhatsApp Gateway - captures outbound messages
    mockWhatsAppGatewayServer = createServer(async (req, res) => {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      capturedByWaGateway.push({ path: req.url || '', body: parsed });

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'whatsapp-gateway',
            status: 'healthy',
            uptime: 100,
            dependencies: [{ name: 'whatsapp', status: 'healthy' }],
          }),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    // Simple API Gateway that routes based on path
    mockApiGatewayServer = createServer(async (req, res) => {
      const url = req.url || '/';
      const method = req.method || 'GET';
      const body = await readBody(req);

      // Route to Core
      const coreRoutes = [
        '/api/v1/messages/inbound',
        '/api/v1/chat-metadata',
        '/api/v1/groups/registered',
      ];

      // Route to WhatsApp Gateway
      const waRoutes = [
        '/api/v1/messages/outbound',
        '/api/v1/typing',
        '/api/v1/groups/sync',
        '/api/v1/groups/join',
      ];

      let targetPort: number | null = null;
      if (coreRoutes.some((r) => url.startsWith(r))) {
        targetPort = corePort;
      } else if (waRoutes.some((r) => url.startsWith(r))) {
        targetPort = waGatewayPort;
      }

      if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'api-gateway',
            status: 'healthy',
            uptime: 100,
            dependencies: [],
          }),
        );
        return;
      }

      if (targetPort === null) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      // Forward request
      const fwdReq = httpRequest(
        {
          hostname: '127.0.0.1',
          port: targetPort,
          path: url,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (fwdRes) => {
          res.writeHead(fwdRes.statusCode!, fwdRes.headers);
          fwdRes.pipe(res);
        },
      );
      fwdReq.on('error', () => {
        res.writeHead(502);
        res.end('Bad Gateway');
      });
      fwdReq.write(body);
      fwdReq.end();
    });

    // Start all mock servers
    await Promise.all([
      new Promise<void>((r) =>
        mockCoreServer.listen(corePort, '127.0.0.1', r),
      ),
      new Promise<void>((r) =>
        mockWhatsAppGatewayServer.listen(waGatewayPort, '127.0.0.1', r),
      ),
      new Promise<void>((r) =>
        mockApiGatewayServer.listen(apiGatewayPort, '127.0.0.1', r),
      ),
    ]);
  });

  afterAll(async () => {
    mockCoreServer?.close();
    mockWhatsAppGatewayServer?.close();
    mockApiGatewayServer?.close();
  });

  it('routes inbound message from WhatsApp Gateway through API Gateway to Core', async () => {
    const inboundMsg = {
      id: 'msg-001',
      chatJid: '1234@g.us',
      sender: '5678@s.whatsapp.net',
      senderName: 'Alice',
      content: '@Andy hello',
      timestamp: new Date().toISOString(),
      isFromMe: false,
      isBotMessage: false,
      channel: 'whatsapp',
    };

    const result = await postJson(
      apiGatewayPort,
      '/api/v1/messages/inbound',
      inboundMsg,
    );

    expect(result.status).toBe(200);
    expect(JSON.parse(result.data)).toEqual({ ok: true });

    // Verify the message reached Core
    const coreMsg = capturedByCore.find(
      (m) => m.path === '/api/v1/messages/inbound',
    );
    expect(coreMsg).toBeDefined();
    expect(coreMsg!.body.chatJid).toBe('1234@g.us');
    expect(coreMsg!.body.content).toBe('@Andy hello');
  });

  it('routes outbound message from Core through API Gateway to WhatsApp Gateway', async () => {
    const outboundMsg = {
      chatJid: '1234@g.us',
      text: 'Hello World!',
    };

    const result = await postJson(
      apiGatewayPort,
      '/api/v1/messages/outbound',
      outboundMsg,
    );

    expect(result.status).toBe(200);
    expect(JSON.parse(result.data)).toEqual({ ok: true });

    // Verify the message reached WhatsApp Gateway
    const waMsg = capturedByWaGateway.find(
      (m) => m.path === '/api/v1/messages/outbound',
    );
    expect(waMsg).toBeDefined();
    expect(waMsg!.body.chatJid).toBe('1234@g.us');
    expect(waMsg!.body.text).toBe('Hello World!');
  });

  it('routes chat metadata through API Gateway to Core', async () => {
    const metadata = {
      chatJid: '1234@g.us',
      timestamp: new Date().toISOString(),
      name: 'Test Group',
      channel: 'whatsapp',
      isGroup: true,
    };

    const result = await postJson(
      apiGatewayPort,
      '/api/v1/chat-metadata',
      metadata,
    );

    expect(result.status).toBe(200);

    const coreMeta = capturedByCore.find(
      (m) => m.path === '/api/v1/chat-metadata',
    );
    expect(coreMeta).toBeDefined();
    expect(coreMeta!.body.chatJid).toBe('1234@g.us');
    expect(coreMeta!.body.name).toBe('Test Group');
  });

  it('routes typing indicator through API Gateway to WhatsApp Gateway', async () => {
    const typing = { chatJid: '1234@g.us', isTyping: true };

    const result = await postJson(apiGatewayPort, '/api/v1/typing', typing);

    expect(result.status).toBe(200);

    const waTyping = capturedByWaGateway.find(
      (m) => m.path === '/api/v1/typing',
    );
    expect(waTyping).toBeDefined();
    expect(waTyping!.body.isTyping).toBe(true);
  });

  it('routes registered groups request through API Gateway to Core', async () => {
    const result = await getJson(
      apiGatewayPort,
      '/api/v1/groups/registered',
    );

    expect(result.status).toBe(200);
    const data = JSON.parse(result.data);
    expect(data.groups).toBeDefined();
    expect(data.groups['1234@g.us']).toBeDefined();
    expect(data.groups['1234@g.us'].name).toBe('Test Group');
  });

  it('routes group sync through API Gateway to WhatsApp Gateway', async () => {
    const result = await postJson(apiGatewayPort, '/api/v1/groups/sync', {
      force: true,
    });

    expect(result.status).toBe(200);

    const waSync = capturedByWaGateway.find(
      (m) => m.path === '/api/v1/groups/sync',
    );
    expect(waSync).toBeDefined();
    expect(waSync!.body.force).toBe(true);
  });
});
