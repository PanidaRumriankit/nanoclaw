import pino from 'pino';
import { LOG_LEVEL } from './config.js';

export const logger = pino({
  level: LOG_LEVEL,
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});
