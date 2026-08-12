import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { OfferStatus } from '@prisma/client';

export class OfferController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        search,
        status,
        category,
        country,
        sort = 'createdAt:desc',
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { category: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (status) {
        where.status = status as OfferStatus;
      }
      if (category) {
        where.category = category as string;
      }
      if (country) {
        where.country = country as string;
      }

      const [sortField, sortOrder] = (sort as string).split(':');
      const orderBy: any = {};
      orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

      const cacheKey = `offers:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const [offers, total] = await Promise.all([
        prisma.offer.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            network: {
              select: {
                id: true,
                name: true,
              },
            },
            _count: {
              select: {
                clicks: true,
                conversions: true,
              },
            },
          },
        }),
        prisma.offer.count({ where }),
      ]);

      const result = {
        data: offers,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      };

      await cache.set(cacheKey, result, 60);
      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const cacheKey = `offer:${id}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const offer = await prisma.offer.findUnique({
        where: { id },
        include: {
          network: true,
          _count: {
            select: {
              clicks: true,
              conversions: true,
            },
          },
        },
      });

      if (!offer) {
        throw new AppError('Offer not found', 404);
      }

      await cache.set(cacheKey, offer, 300);
      res.json(offer);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        name,
        category,
        country,
        deviceTargeting,
        browserTargeting,
        payout,
        dailyCap,
        hourlyCap,
        startDate,
        endDate,
        networkId,
      } = req.body;

      // Check if network exists
      const network = await prisma.network.findUnique({
        where: { id: networkId },
      });

      if (!network) {
        throw new AppError('Network not found', 404);
      }

      // Check if offer name already exists for this network
      const existing = await prisma.offer.findFirst({
        where: {
          name,
          networkId,
        },
      });

      if (existing) {
        throw new AppError('Offer with this name already exists for this network', 409);
      }

      const offer = await prisma.offer.create({
        data: {
          name,
          category,
          country,
          deviceTargeting,
          browserTargeting,
          payout,
          dailyCap,
          hourlyCap,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          networkId,
          status: 'ACTIVE',
          previewLink: `/preview/${Buffer.from(name).toString('base64')}`,
        },
      });

      await cache.delPattern('offers:*');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE',
          resource: 'Offer',
          resourceId: offer.id,
          changes: { offer },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json(offer);
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
        category,
        country,
        deviceTargeting,
        browserTargeting,
        payout,
        dailyCap,
        hourlyCap,
        startDate,
        endDate,
        networkId,
        status,
      } = req.body;

      const existing = await prisma.offer.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Offer not found', 404);
      }

      // Check if new name conflicts
      if (name && name !== existing.name) {
        const conflict = await prisma.offer.findFirst({
          where: {
            name,
            networkId: networkId || existing.networkId,
            NOT: { id },
          },
        });

        if (conflict) {
          throw new AppError('Offer name already in use', 409);
        }
      }

      const offer = await prisma.offer.update({
        where: { id },
        data: {
          name,
          category,
          country,
          deviceTargeting,
          browserTargeting,
          payout,
          dailyCap,
          hourlyCap,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          networkId,
          status: status as OfferStatus,
        },
      });

      await cache.delPattern(`offer:${id}`);
      await cache.delPattern('offers:*');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'Offer',
          resourceId: id,
          changes: { before: existing, after: offer },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(offer);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const existing = await prisma.offer.findUnique({
        where: { id },
        include: {
          clicks: {
            take: 1,
          },
          conversions: {
            take: 1,
          },
        },
      });

      if (!existing) {
        throw new AppError('Offer not found', 404);
      }

      if (existing.clicks.length > 0 || existing.conversions.length > 0) {
        throw new AppError('Cannot delete offer with associated clicks or conversions', 400);
      }

      await prisma.offer.delete({
        where: { id },
      });

      await cache.delPattern(`offer:${id}`);
      await cache.delPattern('offers:*');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DELETE',
          resource: 'Offer',
          resourceId: id,
          changes: { offer: existing },
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

  static async clone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const original = await prisma.offer.findUnique({
        where: { id },
      });

      if (!original) {
        throw new AppError('Offer not found', 404);
      }

      const cloned = await prisma.offer.create({
        data: {
          name: `${original.name} (Clone)`,
          category: original.category,
          country: original.country,
          deviceTargeting: original.deviceTargeting,
          browserTargeting: original.browserTargeting,
          payout: original.payout,
          dailyCap: original.dailyCap,
          hourlyCap: original.hourlyCap,
          startDate: original.startDate,
          endDate: original.endDate,
          networkId: original.networkId,
          status: 'PAUSED',
          previewLink: `/preview/${Buffer.from(`${original.name} (Clone)`).toString('base64')}`,
        },
      });

      await cache.delPattern('offers:*');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CLONE',
          resource: 'Offer',
          resourceId: cloned.id,
          changes: { originalId: id, cloned },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json(cloned);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existing = await prisma.offer.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Offer not found', 404);
      }

      const offer = await prisma.offer.update({
        where: { id },
        data: { status: status as OfferStatus },
      });

      await cache.delPattern(`offer:${id}`);
      await cache.delPattern('offers:*');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE_STATUS',
          resource: 'Offer',
          resourceId: id,
          changes: { before: existing.status, after: status },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(offer);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async bulkImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rows } = req.body;

      if (!Array.isArray(rows) || rows.length === 0) {
        throw new AppError('Invalid data format', 400);
      }

      const imported = await prisma.$transaction(async (tx) => {
        let count = 0;
        for (const row of rows) {
          // Check if network exists
          const network = await tx.network.findUnique({
            where: { id: row.networkId },
          });

          if (!network) {
            continue;
          }

          // Check for duplicate
          const existing = await tx.offer.findFirst({
            where: {
              name: row.name,
              networkId: row.networkId,
            },
          });

          if (!existing) {
            await tx.offer.create({
              data: {
                name: row.name,
                category: row.category || null,
                country: row.country || null,
                deviceTargeting: row.deviceTargeting || null,
                browserTargeting: row.browserTargeting || null,
                payout: row.payout || null,
                dailyCap: row.dailyCap || null,
                hourlyCap: row.hourlyCap || null,
                startDate: row.startDate ? new Date(row.startDate) : null,
                endDate: row.endDate ? new Date(row.endDate) : null,
                networkId: row.networkId,
                status: 'ACTIVE',
                previewLink: `/preview/${Buffer.from(row.name).toString('base64')}`,
              },
            });
            count++;
          }
        }
        return count;
      });

      await cache.delPattern('offers:*');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'BULK_IMPORT',
          resource: 'Offer',
          changes: { imported },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        imported,
        total: rows.length,
        message: `Successfully imported ${imported} offers`,
        skipped: rows.length - imported,
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}