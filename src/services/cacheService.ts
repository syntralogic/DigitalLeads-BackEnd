import { cache } from '../config/redis';
import { logger } from '../config/logger';

export class CacheService {
  static async get<T>(key: string): Promise<T | null> {
    try {
      return await cache.get<T>(key);
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  static async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      await cache.set(key, value, ttlSeconds);
    } catch (error) {
      logger.error('Cache set error:', error);
    }
  }

  static async delete(key: string): Promise<void> {
    try {
      await cache.del(key);
    } catch (error) {
      logger.error('Cache delete error:', error);
    }
  }

  static async deletePattern(pattern: string): Promise<void> {
    try {
      await cache.delPattern(pattern);
    } catch (error) {
      logger.error('Cache delete pattern error:', error);
    }
  }

  static async remember<T>(
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
  }

  static async increment(key: string): Promise<number> {
    try {
      return await cache.increment(key);
    } catch (error) {
      logger.error('Cache increment error:', error);
      return 0;
    }
  }

  static async rateLimit(key: string, limit: number, windowSeconds: number): Promise<{
    allowed: boolean;
    remaining: number;
  }> {
    try {
      return await cache.rateLimit(key, limit, windowSeconds);
    } catch (error) {
      logger.error('Rate limit error:', error);
      return { allowed: true, remaining: limit };
    }
  }
}