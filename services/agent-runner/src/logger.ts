import pino from 'pino';
import { LOG_LEVEL, SERVICE_NAME } from './config.js';

export const logger = pino({
  name: SERVICE_NAME,
  level: LOG_LEVEL,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
