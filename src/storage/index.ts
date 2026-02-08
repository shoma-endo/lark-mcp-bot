export { ConversationStorage } from './interface.js';
export { MemoryStorage } from './memory.js';
export { RedisStorage } from './redis.js';

import { MemoryStorage } from './memory.js';
import { RedisStorage } from './redis.js';
import type { ConversationStorage } from './interface.js';
import { logger } from '../utils/logger.js';

/**
 * Create conversation storage based on environment
 * Uses Redis in production (Vercel), Memory in development
 */
export function createStorage(): ConversationStorage {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      logger.info('Using Redis storage (production mode)');
      return new RedisStorage(redisUrl, redisToken);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn('Redis initialization failed, falling back to Memory storage', undefined, err);
    }
  }

  logger.info('Using Memory storage (development mode)');
  return new MemoryStorage();
}
