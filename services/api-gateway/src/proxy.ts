/**
 * HTTP Proxy — Generic reverse proxy logic for routing requests to backends.
 *
 * Similar pattern to credential-proxy.ts but generalized for any backend.
 */
import { IncomingMessage, ServerResponse } from 'http';
import { request as httpRequest, RequestOptions } from 'http';

import { logger } from './logger.js';

/**
 * Forward an incoming request to the specified backend URL.
 * Streams request body and response back to the caller.
 */
export function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendUrl: string,
  pathOverride?: string,
): void {
  const url = new URL(backendUrl);
  const targetPath = pathOverride ?? req.url ?? '/';

  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const headers: Record<string, string | number | string[] | undefined> = {
      ...(req.headers as Record<string, string>),
      host: url.host,
      'content-length': body.length,
    };

    // Strip hop-by-hop headers
    delete headers['connection'];
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];

    const options: RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: targetPath,
      method: req.method,
      headers,
    };

    const startTime = Date.now();
    const upstream = httpRequest(options, (upRes) => {
      const latency = Date.now() - startTime;
      logger.debug(
        {
          method: req.method,
          path: targetPath,
          backend: backendUrl,
          status: upRes.statusCode,
          latencyMs: latency,
        },
        'Proxied request',
      );
      res.writeHead(upRes.statusCode!, upRes.headers);
      upRes.pipe(res);
    });

    upstream.on('error', (err) => {
      const latency = Date.now() - startTime;
      logger.error(
        {
          err,
          method: req.method,
          path: targetPath,
          backend: backendUrl,
          latencyMs: latency,
        },
        'Proxy upstream error',
      );
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Bad Gateway',
            backend: url.hostname,
            message: err.message,
          }),
        );
      }
    });

    upstream.write(body);
    upstream.end();
  });
}

/**
 * Make a JSON request to a backend and return the parsed response.
 * Used for health check aggregation.
 */
export function fetchJson<T>(
  url: string,
  timeoutMs = 5000,
): Promise<{ data: T; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const startTime = Date.now();

    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: timeoutMs,
        headers: { accept: 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString()) as T;
            resolve({ data, latencyMs });
          } catch (err) {
            reject(new Error(`Failed to parse response from ${url}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });

    req.end();
  });
}
