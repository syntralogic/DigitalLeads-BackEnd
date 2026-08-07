import { Request, Response, NextFunction } from 'express';
import { cache } from '../config/redis';
import { logger } from '../config/logger';

interface CacheOptions {
  ttl?: number;
  keyPrefix?: string;
  onlyGet?: boolean;
  skipCache?: (req: Request) => boolean;
}

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const {
    ttl = 60,
    keyPrefix = 'cache',
    onlyGet = false,
    skipCache,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip caching for non-GET requests unless onlyGet is false
    if (onlyGet && req.method !== 'GET') {
      return next();
    }

    // Check if should skip cache
    if (skipCache && skipCache(req)) {
      return next();
    }

    // Generate cache key
    const key = `${keyPrefix}:${req.user?.id || 'public'}:${req.originalUrl || req.url}`;

    try {
      // Try to get from cache
      const cachedData = await cache.get(key);
      if (cachedData) {
        logger.debug(`Cache hit for ${key}`);
        return res.json(cachedData);
      }

      // Store original json method
      const originalJson = res.json;
      res.json = function(data: any) {
        // Cache the response
        const shouldCache = res.statusCode >= 200 && res.statusCode < 300;
        if (shouldCache && !onlyGet) {
          cache.set(key, data, ttl).catch(error => {
            logger.error('Cache set error:', error);
          });
        }
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      // If cache fails, continue without caching
      logger.error('Cache middleware error:', error);
      next();
    }
  };
};

// Invalidate cache by pattern
export const invalidateCache = async (pattern: string): Promise<void> => {
  try {
    await cache.delPattern(pattern);
    logger.debug(`Cache invalidated for pattern: ${pattern}`);
  } catch (error) {
    logger.error('Cache invalidation error:', error);
  }
};