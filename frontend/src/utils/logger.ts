/**
 * Logging utility that respects development vs production environment
 *
 * In development: All logs are output to console
 * In production: Only errors and warnings are output
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/utils/logger';
 *
 * logger.debug('Validation result:', data);
 * logger.warn('Deprecated API used');
 * logger.error('Failed to load data', error);
 * ```
 */

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const isDevelopment = import.meta.env.DEV;

export const logger: Logger = {
  debug: isDevelopment ? console.log.bind(console) : () => {},
  info: isDevelopment ? console.info.bind(console) : () => {},
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
