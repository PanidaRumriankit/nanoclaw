import fs from 'fs';
import path from 'path';

import pino from 'pino';

/**
 * Read LOKI_URL directly from process.env or .env file.
 * We cannot import from config.ts because config → env → logger
 * would create a circular dependency.
 */
function readLokiUrl(): string {
  if (process.env.LOKI_URL) return process.env.LOKI_URL;
  try {
    const content = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (key !== 'LOKI_URL') continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    // .env not found — that's fine
  }
  return '';
}

function buildTransport():
  | pino.TransportMultiOptions
  | pino.TransportSingleOptions {
  const lokiUrl = readLokiUrl();

  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino-pretty',
      options: { colorize: true },
      level: 'trace', // let the root logger level filter
    },
  ];

  if (lokiUrl) {
    targets.push({
      target: 'pino-loki',
      options: {
        host: lokiUrl,
        labels: { job: 'nanoclaw' },
        batching: true,
        interval: 5, // flush every 5 seconds
      },
      level: 'trace',
    });
  }

  if (targets.length === 1) {
    return targets[0];
  }

  return { targets };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: buildTransport(),
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
