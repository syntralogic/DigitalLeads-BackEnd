import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { jwtUtils } from '../config/jwt';
import { logger } from '../config/logger';
import { cache } from '../config/redis';
import { UserRole } from '../types';

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, remember } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          password: true,
          name: true,
          role: true,
          avatar: true,
          twoFactorEnabled: true,
          lastLogin: true,
        },
      });

      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
        return;
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      // Generate token
      const token = jwtUtils.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      // Remove password from response
      const { password: _, ...userData } = user;

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN',
          resource: 'User',
          resourceId: user.id,
          changes: { email: user.email, ip: req.ip },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        data: {
          user: userData,
          token,
          expiresIn: remember ? '30d' : '7d',
        },
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, name, role } = req.body;

      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        res.status(409).json({
          success: false,
          message: 'User with this email already exists',
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          role: role || UserRole.VIEWER,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
        },
      });

      // Create notification settings
      await prisma.notificationSetting.create({
        data: {
          userId: user.id,
        },
      });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'REGISTER',
          resource: 'User',
          resourceId: user.id,
          changes: { email: user.email, role: user.role },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: user,
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
          lastLogin: true,
          twoFactorEnabled: true,
          notificationSettings: true,
        },
      });

      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
        });
        return;
      }

      res.json({
        success: true,
        data: user,
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, email, avatar } = req.body;

      // Check if email is being changed and if it's already taken
      if (email) {
        const existingUser = await prisma.user.findFirst({
          where: {
            email,
            NOT: { id: req.user!.id },
          },
        });

        if (existingUser) {
          res.status(409).json({
            success: false,
            message: 'Email already in use',
          });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { name, email, avatar },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
        },
      });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE_PROFILE',
          resource: 'User',
          resourceId: req.user!.id,
          changes: { name, email, avatar },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: user,
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Don't reveal if user exists
        res.json({
          success: true,
          message: 'If an account exists, a password reset link has been sent',
        });
        return;
      }

      // Generate reset token
      const resetToken = jwtUtils.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      // Store reset token in cache with expiry
      await cache.set(`reset:${resetToken}`, user.id, 3600);

      // In production, send email with reset link
      logger.info(`Password reset requested for ${email}`, { userId: user.id });

      res.json({
        success: true,
        message: 'If an account exists, a password reset link has been sent',
        // In development, return token for testing
        ...(process.env.NODE_ENV === 'development' && { resetToken }),
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body;

      // Verify token
      const decoded = jwtUtils.verify(token);
      const userId = await cache.get(`reset:${token}`);

      if (!userId || userId !== decoded.userId) {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token',
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.user.update({
        where: { id: decoded.userId },
        data: { password: hashedPassword },
      });

      // Delete used token
      await cache.del(`reset:${token}`);

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: decoded.userId,
          action: 'RESET_PASSWORD',
          resource: 'User',
          resourceId: decoded.userId,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: 'Password reset successfully',
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.headers.authorization?.substring(7);
      
      if (token) {
        // Blacklist token
        const decoded = jwtUtils.decode(token);
        if (decoded) {
          const ttl = await cache.ttl(token);
          if (ttl > 0) {
            await cache.set(`blacklist:${token}`, true, ttl);
          }
        }
      }

      // Log audit
      if (req.user) {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'LOGOUT',
            resource: 'User',
            resourceId: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          },
        });
      }

      // Clear session
      req.session.destroy((err) => {
        if (err) {
          logger.error('Session destroy error:', err);
        }
      });

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          message: 'Refresh token required',
        });
        return;
      }

      const decoded = jwtUtils.verify(refreshToken);
      const newToken = jwtUtils.sign({
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      });

      res.json({
        success: true,
        data: {
          token: newToken,
        },
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}