import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

export class RoutingController {
  static async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'routing:rules';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
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
      res.json(rules);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        name,
        type,
        conditions,
        weight,
        targetOfferId,
        backupOfferId,
        priority,
        enabled,
      } = req.body;

      // Validate target offer if provided
      if (targetOfferId) {
        const offer = await prisma.offer.findUnique({
          where: { id: targetOfferId },
        });
        if (!offer) {
          throw new AppError('Target offer not found', 404);
        }
      }

      // Validate backup offer if provided
      if (backupOfferId) {
        const offer = await prisma.offer.findUnique({
          where: { id: backupOfferId },
        });
        if (!offer) {
          throw new AppError('Backup offer not found', 404);
        }
      }

      const rule = await prisma.routingRule.create({
        data: {
          name,
          type,
          conditions,
          weight: weight || 100,
          targetOfferId,
          backupOfferId,
          priority: priority || 0,
          enabled: enabled !== undefined ? enabled : true,
        },
      });

      await cache.delPattern('routing:rules');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE',
          resource: 'RoutingRule',
          resourceId: rule.id,
          changes: { rule },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json(rule);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const {
        name,
        type,
        conditions,
        weight,
        targetOfferId,
        backupOfferId,
        priority,
        enabled,
      } = req.body;

      const existing = await prisma.routingRule.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Routing rule not found', 404);
      }

      // Validate target offer if provided
      if (targetOfferId) {
        const offer = await prisma.offer.findUnique({
          where: { id: targetOfferId },
        });
        if (!offer) {
          throw new AppError('Target offer not found', 404);
        }
      }

      // Validate backup offer if provided
      if (backupOfferId) {
        const offer = await prisma.offer.findUnique({
          where: { id: backupOfferId },
        });
        if (!offer) {
          throw new AppError('Backup offer not found', 404);
        }
      }

      const rule = await prisma.routingRule.update({
        where: { id },
        data: {
          name,
          type,
          conditions,
          weight,
          targetOfferId,
          backupOfferId,
          priority,
          enabled,
        },
      });

      await cache.delPattern('routing:rules');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'RoutingRule',
          resourceId: id,
          changes: { before: existing, after: rule },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(rule);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const existing = await prisma.routingRule.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Routing rule not found', 404);
      }

      await prisma.routingRule.delete({
        where: { id },
      });

      await cache.delPattern('routing:rules');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DELETE',
          resource: 'RoutingRule',
          resourceId: id,
          changes: { rule: existing },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(204).send();
      return;
    } catch (error) {
      next(error);
    }
  }

  static async reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError('Invalid IDs array', 400);
      }

      // Update priorities
      await prisma.$transaction(
        ids.map((id, index) =>
          prisma.routingRule.update({
            where: { id },
            data: { priority: index },
          })
        )
      );

      await cache.delPattern('routing:rules');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'REORDER',
          resource: 'RoutingRule',
          changes: { ids },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: 'Routing rules reordered successfully',
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}