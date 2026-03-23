import { Redis } from '@upstash/redis';
import { logger } from '../utils/logger.js';

export interface UATRecord {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix seconds
}

/** Per-user access token store backed by Redis or in-memory fallback. */
export class UATStore {
  private redis: Redis | null = null;
  private memory: Map<string, unknown> = new Map();

  private readonly UAT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
  private readonly STATE_TTL_SECONDS = 600;              // 10 minutes

  constructor(redisUrl?: string, redisToken?: string) {
    if (redisUrl && redisToken) {
      try {
        // Trim whitespace/newlines from Redis token
        const trimmedUrl = redisUrl.trim();
        const trimmedToken = redisToken.trim();
        this.redis = new Redis({ url: trimmedUrl, token: trimmedToken });
        logger.info('UATStore: Redis connected');
      } catch (err) {
        logger.warn('UATStore: Redis init failed, using in-memory fallback', undefined, err as Error);
      }
    } else {
      logger.info('UATStore: Redis env vars not set, using in-memory fallback');
    }
  }

  async getUAT(openId: string): Promise<UATRecord | null> {
    if (this.redis) {
      return this.redis.get<UATRecord>(`uat:${openId}`);
    }
    return (this.memory.get(`uat:${openId}`) as UATRecord) ?? null;
  }

  async setUAT(openId: string, record: UATRecord): Promise<void> {
    if (this.redis) {
      await this.redis.set(`uat:${openId}`, record, { ex: this.UAT_TTL_SECONDS });
    } else {
      this.memory.set(`uat:${openId}`, record);
    }
  }

  async deleteUAT(openId: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(`uat:${openId}`);
    } else {
      this.memory.delete(`uat:${openId}`);
    }
  }

  async setOAuthState(stateId: string, openId: string): Promise<void> {
    if (this.redis) {
      await this.redis.set(`oauth-state:${stateId}`, openId, { ex: this.STATE_TTL_SECONDS });
    } else {
      this.memory.set(`state:${stateId}`, openId);
    }
  }

  async getAndDeleteOAuthState(stateId: string): Promise<string | null> {
    if (this.redis) {
      const openId = await this.redis.get<string>(`oauth-state:${stateId}`);
      if (openId) await this.redis.del(`oauth-state:${stateId}`);
      return openId;
    }
    const openId = this.memory.get(`state:${stateId}`) as string | undefined;
    if (openId) {
      this.memory.delete(`state:${stateId}`);
      return openId;
    }
    return null;
  }
}

let _store: UATStore | null = null;

export function getUATStore(): UATStore {
  if (!_store) {
    _store = new UATStore(
      process.env.KV_REST_API_URL,
      process.env.KV_REST_API_TOKEN
    );
  }
  return _store;
}
