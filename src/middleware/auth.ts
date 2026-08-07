import { Request, Response, NextFunction } from 'express';
import { jwtUtils, JwtPayload } from '../config/jwt';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { cache } from '../config/redis';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
      apiKey?: string;
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Check for API key first
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      const user = await validateApiKey(apiKey);
      if (user) {
        req.user = user;
        next();
        return;
      }
    }

    // Then check for JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. Please provide a valid token or API key.',
      });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = await validateToken(token);

    // Check if user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true, lastLogin: true },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found or inactive.',
      });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Authentication error:', { error: error.message, path: req.path });
      res.status(401).json({
        success: false,
        message: error.message || 'Authentication failed.',
      });
      return;
    }
    next(error);
  }
};

async function validateToken(token: string): Promise<JwtPayload> {
  try {
    const decoded = jwtUtils.verify(token);

    // Check if token is blacklisted
    const isBlacklisted = await cache.get(`blacklist:${token}`);
    if (isBlacklisted) {
      throw new Error('Token has been revoked');
    }

    return decoded;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error('Invalid token');
  }
}

async function validateApiKey(apiKey: string) {
  try {
    // In production, this should compare hashed keys
    const keyRecord = await prisma.apiKey.findFirst({
      where: {
        keyHash: apiKey, // Should be hashed in production
        revoked: false,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!keyRecord) {
      return null;
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsed: new Date() },
    });

    return keyRecord.user;
  } catch (error) {
    logger.error('API key validation error:', error);
    return null;
  }
}

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Please authenticate.',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Forbidden. Required roles: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
};

export const requireApiKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    res.status(401).json({
      success: false,
      message: 'API key required.',
    });
    return;
  }

  const user = await validateApiKey(apiKey);
  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Invalid API key.',
    });
    return;
  }

  req.user = user;
  next();
};

export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = await validateToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, role: true },
      });
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch {
    next();
  }
};