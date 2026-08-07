import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';

export class RoutingService {
  static async list() {
    const cacheKey = 'routing:rules';
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const rules = await prisma.routingRule.findMany({
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        targetOffer: {
          select: {
            id: true,
            name: true,
          },
        },
        backupOffer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await cache.set(cacheKey, rules, 60);
    return rules;
  }

  static async create(data: {
    name: string;
    type: string;
    conditions: any;
    weight?: number;
    targetOfferId?: string;
    backupOfferId?: string;
    priority?: number;
    enabled?: boolean;
  }) {
    // Validate target offer
    if (data.targetOfferId) {
      const offer = await prisma.offer.findUnique({
        where: { id: data.targetOfferId },
      });
      if (!offer) {
        throw new Error('Target offer not found');
      }
    }

    // Validate backup offer
    if (data.backupOfferId) {
      const offer = await prisma.offer.findUnique({
        where: { id: data.backupOfferId },
      });
      if (!offer) {
        throw new Error('Backup offer not found');
      }
    }

    const rule = await prisma.routingRule.create({
      data: {
        name: data.name,
        type: data.type as any,
        conditions: data.conditions,
        weight: data.weight || 100,
        targetOfferId: data.targetOfferId,
        backupOfferId: data.backupOfferId,
        priority: data.priority || 0,
        enabled: data.enabled !== undefined ? data.enabled : true,
      },
    });

    await cache.del('routing:rules');
    return rule;
  }

  static async update(id: string, data: {
    name?: string;
    type?: string;
    conditions?: any;
    weight?: number;
    targetOfferId?: string;
    backupOfferId?: string;
    priority?: number;
    enabled?: boolean;
  }) {
    const existing = await prisma.routingRule.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error('Routing rule not found');
    }

    // Validate target offer
    if (data.targetOfferId) {
      const offer = await prisma.offer.findUnique({
        where: { id: data.targetOfferId },
      });
      if (!offer) {
        throw new Error('Target offer not found');
      }
    }

    // Validate backup offer
    if (data.backupOfferId) {
      const offer = await prisma.offer.findUnique({
        where: { id: data.backupOfferId },
      });
      if (!offer) {
        throw new Error('Backup offer not found');
      }
    }

    const rule = await prisma.routingRule.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type as any,
        conditions: data.conditions,
        weight: data.weight,
        targetOfferId: data.targetOfferId,
        backupOfferId: data.backupOfferId,
        priority: data.priority,
        enabled: data.enabled,
      },
    });

    await cache.del('routing:rules');
    return rule;
  }

  static async delete(id: string) {
    const existing = await prisma.routingRule.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error('Routing rule not found');
    }

    await prisma.routingRule.delete({
      where: { id },
    });

    await cache.del('routing:rules');
  }

  static async reorder(ids: string[]) {
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.routingRule.update({
          where: { id },
          data: { priority: index },
        })
      )
    );

    await cache.del('routing:rules');
    return { success: true };
  }
}