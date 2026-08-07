import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

export const rateLimit = (options: RateLimitOptions) => {
  const {
    windowMs = 60000,
    max = 100,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => {
      return `${req.ip}:${req.path}`;
    },
    skip = () => false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) {
      return next();
    }

    const key = `rate-limit:${keyGenerator(req)}`;
    
    try {
      const current = await redis.get(key);
      const count = current ? parseInt(current) : 0;

      if (count >= max) {
        const ttl = await redis.ttl(key);
        return res.status(429).json({
          success: false,
          message,
          retryAfter: ttl > 0 ? ttl : 60,
        });
      }

      await redis.incr(key);
      if (count === 0) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + windowMs) / 1000));

      next();
    } catch (error) {
      logger.error('Rate limit error:', error);
      // If Redis fails, allow the request
      next();
    }
  };
};

// Pre-configured rate limiters
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: 'Too many requests. Please slow down.',
});

export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many requests. Please try again later.',
});

export const relaxedRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500,
  message: 'Rate limit exceeded. Please try again later.',
});

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts. Please try again later.',
  keyGenerator: (req) => {
    return `login:${req.body.email || req.ip}`;
  },
});

export const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  message: 'API rate limit exceeded.',
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] as string;
    return `api:${apiKey || req.ip}`;
  },
});