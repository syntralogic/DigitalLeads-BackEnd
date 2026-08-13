import Redis from 'ioredis';
import { logger } from './logger';

// Use Upstash Redis environment variables
const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_PASSWORD;

// Determine if we're using Upstash (REST API) or standard Redis
const isUpstash = UPSTASH_REDIS_URL?.includes('upstash.io') || false;

let redis: Redis;

if (isUpstash && UPSTASH_REDIS_URL) {
  // Upstash Redis uses REST API with token authentication
  redis = new Redis({
    host: new URL(UPSTASH_REDIS_URL).hostname,
    port: 443,
    password: UPSTASH_REDIS_TOKEN,
    tls: {},
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnect attempt ${times}, delay: ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
} else {
  // Standard Redis connection (local or other)
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
  
  redis = new Redis(REDIS_URL, {
    password: REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnect attempt ${times}, delay: ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

// Event listeners
redis.on('connect', () => {
  logger.info('🔗 Redis connected successfully');
});

redis.on('ready', () => {
  logger.info('✅ Redis ready');
});

redis.on('error', (error) => {
  logger.error('❌ Redis connection error:', error);
});

redis.on('close', () => {
  logger.warn('⚠️ Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.warn('🔄 Redis reconnecting...');
});

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as T;
      } catch {
        return data as T;
      }
    } catch (error) {
      logger.error(`Redis get error for key ${key}:`, error);
      return null;
    }
  },

  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, serialized);
      } else {
        await redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error(`Redis set error for key ${key}:`, error);
      return false;
    }
  },

  async del(key: string): Promise<boolean> {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      logger.error(`Redis del error for key ${key}:`, error);
      return false;
    }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error(`Redis delPattern error for pattern ${pattern}:`, error);
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Redis exists error for key ${key}:`, error);
      return false;
    }
  },

  async increment(key: string): Promise<number> {
    try {
      return await redis.incr(key);
    } catch (error) {
      logger.error(`Redis increment error for key ${key}:`, error);
      return 0;
    }
  },

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      await redis.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error(`Redis expire error for key ${key}:`, error);
      return false;
    }
  },

  async ttl(key: string): Promise<number> {
    try {
      return await redis.ttl(key);
    } catch (error) {
      logger.error(`Redis ttl error for key ${key}:`, error);
      return -2;
    }
  },

  async flush(): Promise<void> {
    try {
      await redis.flushdb();
    } catch (error) {
      logger.error('Redis flush error:', error);
    }
  },

  async remember<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    await this.set(key, data, ttlSeconds);
    return data;
  },

  async rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
    const current = await this.increment(key);
    if (current === 1) {
      await this.expire(key, windowSeconds);
    }
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
    };
  },
};

export { redis };