import { createRequire } from 'module';
import type { ConversationMessage } from '../types.js';
import type { ConversationStorage } from './interface.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

interface RedisLikeClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number }): Promise<unknown>;
  sadd(key: string, value: string): Promise<unknown>;
  srem(key: string, value: string): Promise<unknown>;
  smembers(key: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Redis-based conversation storage using Upstash
 * Used for production deployment on Vercel
 */
export class RedisStorage implements ConversationStorage {
  private redis: RedisLikeClient;
  private readonly HISTORY_PREFIX = 'conversation:';
  private readonly TIMESTAMP_PREFIX = 'timestamp:';
  private readonly CHATIDS_KEY = 'chatids';

  constructor(redisUrl: string, redisToken: string) {
    const upstash = require('@upstash/redis') as {
      Redis: new (args: { url: string; token: string }) => RedisLikeClient;
    };

    this.redis = new upstash.Redis({
      url: redisUrl,
      token: redisToken,
    });

    logger.info('Redis storage initialized', undefined, {
      url: redisUrl.substring(0, 30) + '...',
    });
  }

  async getHistory(chatId: string): Promise<ConversationMessage[]> {
    try {
      const key = this.HISTORY_PREFIX + chatId;
      const data = await this.redis.get<ConversationMessage[]>(key);
      return data || [];
    } catch (error) {
      logger.error('Failed to get conversation history from Redis', { chatId } as any, error as Error);
      return [];
    }
  }

  async setHistory(chatId: string, messages: ConversationMessage[]): Promise<void> {
    try {
      const historyKey = this.HISTORY_PREFIX + chatId;
      const timestampKey = this.TIMESTAMP_PREFIX + chatId;

      // Store history with 1 hour expiration
      await this.redis.set(historyKey, JSON.stringify(messages), { ex: 3600 });

      // Store timestamp
      await this.redis.set(timestampKey, Date.now(), { ex: 3600 });

      // Add to chat IDs set
      await this.redis.sadd(this.CHATIDS_KEY, chatId);

      logger.debug('Conversation history saved to Redis', { chatId } as any, {
        messageCount: messages.length,
      });
    } catch (error) {
      logger.error('Failed to save conversation history to Redis', { chatId } as any, error as Error);
    }
  }

  async deleteHistory(chatId: string): Promise<void> {
    try {
      const historyKey = this.HISTORY_PREFIX + chatId;
      const timestampKey = this.TIMESTAMP_PREFIX + chatId;

      await this.redis.del(historyKey);
      await this.redis.del(timestampKey);
      await this.redis.srem(this.CHATIDS_KEY, chatId);

      logger.debug('Conversation history deleted from Redis', { chatId } as any);
    } catch (error) {
      logger.error('Failed to delete conversation history from Redis', { chatId } as any, error as Error);
    }
  }

  async getAllChatIds(): Promise<string[]> {
    try {
      const chatIds = await this.redis.smembers(this.CHATIDS_KEY);
      return (chatIds as string[]) || [];
    } catch (error) {
      logger.error('Failed to get all chat IDs from Redis', undefined, error as Error);
      return [];
    }
  }

  async getTimestamp(chatId: string): Promise<number | null> {
    try {
      const key = this.TIMESTAMP_PREFIX + chatId;
      const timestamp = await this.redis.get<number>(key);
      return timestamp;
    } catch (error) {
      logger.error('Failed to get timestamp from Redis', { chatId } as any, error as Error);
      return null;
    }
  }

  async setTimestamp(chatId: string, timestamp: number): Promise<void> {
    try {
      const key = this.TIMESTAMP_PREFIX + chatId;
      await this.redis.set(key, timestamp, { ex: 3600 });
    } catch (error) {
      logger.error('Failed to set timestamp in Redis', { chatId } as any, error as Error);
    }
  }

  async cleanup(ttlMs: number): Promise<number> {
    try {
      const chatIds = await this.getAllChatIds();
      const now = Date.now();
      let cleaned = 0;

      for (const chatId of chatIds) {
        const timestamp = await this.getTimestamp(chatId);
        if (timestamp && now - timestamp > ttlMs) {
          await this.deleteHistory(chatId);
          cleaned++;
        }
      }

      logger.info('Redis cleanup completed', undefined, {
        cleaned,
        totalChatIds: chatIds.length,
      });

      return cleaned;
    } catch (error) {
      logger.error('Failed to cleanup Redis', undefined, error as Error);
      return 0;
    }
  }
}
