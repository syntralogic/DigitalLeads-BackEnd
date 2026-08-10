// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        name?: string;
      };
      userId?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me-in-production';

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skip authentication for health check
    if (req.path === '/health') {
      next();
      return;
    }

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      logger.warn(`No authorization header for ${req.method} ${req.path}`);
      res.status(401).json({
        success: false,
        message: 'No token provided',
      });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Invalid token format. Use Bearer token.',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, JWT_SECRET) as { 
        id: string; 
        email: string; 
        role: string;
        userId?: string;
      };

      // Get user ID from token (handle both 'id' and 'userId' fields)
      const userId = decoded.id || decoded.userId;
      
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Invalid token: user ID not found',
        });
        return;
      }

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
        },
      });

      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found',
        });
        return;
      }

      // ✅ Fix: Handle null name properly
      const userData = {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name || undefined,
      };

      // Attach user to request
      req.user = userData;
      req.userId = user.id;
      
      next();
    } catch (jwtError) {
      logger.error('JWT verification failed:', jwtError);
      
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          message: 'Token expired',
        });
        return;
      }
      
      if (jwtError instanceof jwt.JsonWebTokenError) {
        res.status(401).json({
          success: false,
          message: 'Invalid token',
        });
        return;
      }
      
      res.status(401).json({
        success: false,
        message: 'Authentication failed',
      });
      return;
    }
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed',
    });
    return;
  }
};

// Optional: Role-based authorization
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