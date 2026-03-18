import { createRequire } from 'module';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

export interface UATRecord {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix seconds
}

interface RedisKV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Per-user access token store backed by Redis or in-memory fallback. */
export class UATStore {
  private redis: RedisKV | null = null;
  private memory: Map<string, UATRecord> = new Map();

  private readonly UAT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days (refresh token lifetime)
  private readonly STATE_TTL_SECONDS = 600;              // 10 minutes (OAuth state)

  constructor(redisUrl?: string, redisToken?: string) {
    if (redisUrl && redisToken) {
      try {
        const upstash = require('@upstash/redis') as {
          Redis: new (args: { url: string; token: string }) => RedisKV;
        };
        this.redis = new upstash.Redis({ url: redisUrl, token: redisToken });
      } catch {
        logger.warn('UATStore: Redis init failed, using in-memory fallback');
      }
    }
  }

  async getUAT(openId: string): Promise<UATRecord | null> {
    if (this.redis) {
      return this.redis.get<UATRecord>(`uat:${openId}`);
    }
    return this.memory.get(openId) ?? null;
  }

  async setUAT(openId: string, record: UATRecord): Promise<void> {
    if (this.redis) {
      await this.redis.set(`uat:${openId}`, record, { ex: this.UAT_TTL_SECONDS });
    } else {
      this.memory.set(openId, record);
    }
  }

  async deleteUAT(openId: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(`uat:${openId}`);
    } else {
      this.memory.delete(openId);
    }
  }

  async setOAuthState(stateId: string, openId: string): Promise<void> {
    if (this.redis) {
      await this.redis.set(`oauth-state:${stateId}`, openId, { ex: this.STATE_TTL_SECONDS });
    } else {
      // For memory mode, store temporarily in the memory map with a special prefix
      this.memory.set(`state:${stateId}`, { accessToken: openId, refreshToken: '', expiresAt: 0 });
    }
  }

  async getAndDeleteOAuthState(stateId: string): Promise<string | null> {
    if (this.redis) {
      const openId = await this.redis.get<string>(`oauth-state:${stateId}`);
      if (openId) await this.redis.del(`oauth-state:${stateId}`);
      return openId;
    }
    const entry = this.memory.get(`state:${stateId}`);
    if (entry) {
      this.memory.delete(`state:${stateId}`);
      return entry.accessToken; // we stored openId in accessToken field
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
