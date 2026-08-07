import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export class NotificationController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        type,
        read,
        page = 1,
        pageSize = 25,
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {
        userId: req.user!.id,
      };

      if (type) {
        where.type = type as string;
      }

      if (read !== undefined) {
        where.read = read === 'true';
      }

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.notification.count({ where }),
      ]);

      const unread = await prisma.notification.count({
        where: {
          userId: req.user!.id,
          read: false,
        },
      });

      const result = {
        data: notifications,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
        unread,
      };

      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const notification = await prisma.notification.findFirst({
        where: {
          id,
          userId: req.user!.id,
        },
      });

      if (!notification) {
        throw new AppError('Notification not found', 404);
      }

      const updated = await prisma.notification.update({
        where: { id },
        data: { read: true },
      });

      res.json(updated);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await prisma.notification.updateMany({
        where: {
          userId: req.user!.id,
          read: false,
        },
        data: { read: true },
      });

      res.json({
        success: true,
        message: 'All notifications marked as read',
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let settings = await prisma.notificationSetting.findUnique({
        where: { userId: req.user!.id },
      });

      if (!settings) {
        // Create default settings
        settings = await prisma.notificationSetting.create({
          data: {
            userId: req.user!.id,
            telegram: false,
            email: true,
            capAlerts: true,
            conversionAlerts: true,
            networkErrorAlerts: true,
            fraudAlerts: true,
          },
        });
      }

      res.json(settings);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async saveChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        telegram,
        email,
        capAlerts,
        conversionAlerts,
        networkErrorAlerts,
        fraudAlerts,
      } = req.body;

      const settings = await prisma.notificationSetting.upsert({
        where: { userId: req.user!.id },
        update: {
          telegram,
          email,
          capAlerts,
          conversionAlerts,
          networkErrorAlerts,
          fraudAlerts,
        },
        create: {
          userId: req.user!.id,
          telegram,
          email,
          capAlerts,
          conversionAlerts,
          networkErrorAlerts,
          fraudAlerts,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'NotificationSettings',
          resourceId: req.user!.id,
          changes: { settings },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(settings);
      return;
    } catch (error) {
      next(error);
    }
  }

  // Helper method to create notification
  static async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    metadata?: any
  ): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: type as any,
          title,
          message,
          metadata,
        },
      });

      // Check if user has notifications enabled for this type
      const settings = await prisma.notificationSetting.findUnique({
        where: { userId },
      });

      if (settings) {
        // Send email notification
        if (settings.email) {
          // Queue email
          await this.queueEmail(userId, title, message);
        }

        // Send telegram notification
        if (settings.telegram) {
          // Queue telegram
          await this.queueTelegram(userId, title, message);
        }
      }
    } catch (error) {
      console.error('Failed to create notification:', error);
    }
  }

  private static async queueEmail(userId: string, title: string, message: string): Promise<void> {
    // Queue email job
    const { redis } = require('../config/redis');
    await redis.lpush('email:queue', JSON.stringify({
      userId,
      title,
      message,
      timestamp: new Date().toISOString(),
    }));
  }

  private static async queueTelegram(userId: string, title: string, message: string): Promise<void> {
    // Queue telegram job
    const { redis } = require('../config/redis');
    await redis.lpush('telegram:queue', JSON.stringify({
      userId,
      title,
      message,
      timestamp: new Date().toISOString(),
    }));
  }
}