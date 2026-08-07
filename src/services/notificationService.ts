import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

export class NotificationService {
  static async list(userId: string, params: {
    type?: string;
    read?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const { type, read, page = 1, pageSize = 25 } = params;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = { userId };
    if (type) where.type = type;
    if (read !== undefined) where.read = read;

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
        userId,
        read: false,
      },
    });

    return {
      data: notifications,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      unread,
    };
  }

  static async markRead(userId: string, id: string) {
    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  static async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: { read: true },
    });

    return { success: true };
  }

  static async getChannels(userId: string) {
    let settings = await prisma.notificationSetting.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await prisma.notificationSetting.create({
        data: {
          userId,
          telegram: false,
          email: true,
          capAlerts: true,
          conversionAlerts: true,
          networkErrorAlerts: true,
          fraudAlerts: true,
        },
      });
    }

    return settings;
  }

  static async saveChannels(userId: string, data: {
    telegram?: boolean;
    email?: boolean;
    capAlerts?: boolean;
    conversionAlerts?: boolean;
    networkErrorAlerts?: boolean;
    fraudAlerts?: boolean;
  }) {
    const settings = await prisma.notificationSetting.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        ...data,
      },
    });

    return settings;
  }

  static async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    metadata?: any
  ) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type: type as any,
        title,
        message,
        metadata,
      },
    });

    // Check if user has notifications enabled
    const settings = await prisma.notificationSetting.findUnique({
      where: { userId },
    });

    if (settings) {
      // Queue email
      if (settings.email) {
        await redis.lpush('email:queue', JSON.stringify({
          userId,
          title,
          message,
          timestamp: new Date().toISOString(),
        }));
      }

      // Queue telegram
      if (settings.telegram) {
        await redis.lpush('telegram:queue', JSON.stringify({
          userId,
          title,
          message,
          timestamp: new Date().toISOString(),
        }));
      }
    }

    return notification;
  }
}