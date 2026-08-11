import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { NetworkStatus } from '@prisma/client';

export class NetworkController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        search,
        status,
        sort = 'createdAt:desc',
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      // Build filter
      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { apiUrl: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (status) {
        where.status = status as NetworkStatus;
      }

      // Build sort
      const [sortField, sortOrder] = (sort as string).split(':');
      const orderBy: any = {};
      orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

      // Cache key
      const cacheKey = `networks:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const [networks, total] = await Promise.all([
        prisma.network.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            _count: {
              select: {
                offers: true,
                clicks: true,
                conversions: true,
              },
            },
          },
        }),
        prisma.network.count({ where }),
      ]);

      // Get revenue data for each network
      const networkIds = networks.map(n => n.id);
      let revenueMap = new Map();
      
      if (networkIds.length > 0) {
        const revenueData = await prisma.conversion.groupBy({
          by: ['networkId'],
          where: {
            networkId: { in: networkIds },
            status: 'APPROVED',
          },
          _sum: {
            revenue: true,
          },
        });
        
        revenueData.forEach(item => {
          revenueMap.set(item.networkId, item._sum.revenue || 0);
        });
      }

      const result = {
        items: networks.map(network => ({
          id: network.id,
          name: network.name,
          apiUrl: network.apiUrl || null,
          apiKey: network.apiKey || null,
          postbackUrl: network.postbackUrl || null,
          clickIdMapping: network.clickIdMapping || null,
          payoutMapping: network.payoutMapping || null,
          statusMapping: network.statusMapping || null,
          status: network.status,
          apiHealthy: network.apiHealthy,
          postbackHealthy: network.postbackHealthy,
          lastApiCheck: network.lastApiCheck,
          lastPostbackCheck: network.lastPostbackCheck,
          offersCount: network._count?.offers || 0,
          revenue: revenueMap.get(network.id) || 0,
          createdAt: network.createdAt,
          updatedAt: network.updatedAt,
        })),
        total,
        page: Number(page),
        pageSize: Number(pageSize),
      };

      // Cache for 1 minute
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

      const cacheKey = `network:${id}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const network = await prisma.network.findUnique({
        where: { id },
        include: {
          offers: {
            select: {
              id: true,
              name: true,
              status: true,
              payout: true,
            },
          },
          _count: {
            select: {
              clicks: true,
              conversions: true,
            },
          },
        },
      });

      if (!network) {
        throw new AppError('Network not found', 404);
      }

      // Get revenue
      const revenueData = await prisma.conversion.aggregate({
        where: {
          networkId: id,
          status: 'APPROVED',
        },
        _sum: {
          revenue: true,
        },
      });

      const result = {
        ...network,
        offersCount: network._count?.clicks || 0,
        revenue: revenueData._sum.revenue || 0,
      };

      // Cache for 5 minutes
      await cache.set(cacheKey, result, 300);

      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        name,
        apiUrl,
        apiKey,
        postbackUrl,
        clickIdMapping,
        payoutMapping,
        statusMapping,
      } = req.body;

      // Check if network name already exists
      const existing = await prisma.network.findFirst({
        where: { name },
      });

      if (existing) {
        throw new AppError('Network with this name already exists', 409);
      }

      const network = await prisma.network.create({
        data: {
          name,
          apiUrl,
          apiKey,
          postbackUrl,
          clickIdMapping,
          payoutMapping,
          statusMapping,
          status: 'ACTIVE',
        },
      });

      // Invalidate cache
      await cache.delPattern('networks:*');

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE',
          resource: 'Network',
          resourceId: network.id,
          changes: { network },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json(network);
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
        apiUrl,
        apiKey,
        postbackUrl,
        clickIdMapping,
        payoutMapping,
        statusMapping,
        status,
      } = req.body;

      const existing = await prisma.network.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Network not found', 404);
      }

      // Check if name is being changed and if it conflicts
      if (name && name !== existing.name) {
        const conflict = await prisma.network.findFirst({
          where: {
            name,
            NOT: { id },
          },
        });

        if (conflict) {
          throw new AppError('Network name already in use', 409);
        }
      }

      const network = await prisma.network.update({
        where: { id },
        data: {
          name,
          apiUrl,
          apiKey,
          postbackUrl,
          clickIdMapping,
          payoutMapping,
          statusMapping,
          status: status as NetworkStatus,
        },
      });

      // Invalidate cache
      await cache.delPattern(`network:${id}`);
      await cache.delPattern('networks:*');

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'Network',
          resourceId: id,
          changes: { before: existing, after: network },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(network);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const existing = await prisma.network.findUnique({
        where: { id },
        include: {
          offers: {
            take: 1,
          },
        },
      });

      if (!existing) {
        throw new AppError('Network not found', 404);
      }

      if (existing.offers.length > 0) {
        throw new AppError('Cannot delete network with associated offers', 400);
      }

      await prisma.network.delete({
        where: { id },
      });

      // Invalidate cache
      await cache.delPattern(`network:${id}`);
      await cache.delPattern('networks:*');

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DELETE',
          resource: 'Network',
          resourceId: id,
          changes: { network: existing },
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

  static async setStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existing = await prisma.network.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Network not found', 404);
      }

      const network = await prisma.network.update({
        where: { id },
        data: { status: status as NetworkStatus },
      });

      // Invalidate cache
      await cache.delPattern(`network:${id}`);
      await cache.delPattern('networks:*');

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE_STATUS',
          resource: 'Network',
          resourceId: id,
          changes: { before: existing.status, after: status },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(network);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async testConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const network = await prisma.network.findUnique({
        where: { id },
      });

      if (!network) {
        throw new AppError('Network not found', 404);
      }

      if (!network.apiUrl) {
        throw new AppError('Network has no API URL configured', 400);
      }

      // Simulate API test - in production, make actual HTTP request
      const startTime = Date.now();
      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));
      const latencyMs = Date.now() - startTime;
      const isHealthy = latencyMs < 1000;

      // Update network status
      await prisma.network.update({
        where: { id },
        data: {
          apiHealthy: isHealthy,
          lastApiCheck: new Date(),
        },
      });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'TEST_CONNECTION',
          resource: 'Network',
          resourceId: id,
          changes: { latencyMs, healthy: isHealthy },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        ok: isHealthy,
        latencyMs,
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async testPostback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const network = await prisma.network.findUnique({
        where: { id },
      });

      if (!network) {
        throw new AppError('Network not found', 404);
      }

      if (!network.postbackUrl) {
        throw new AppError('Network has no postback URL configured', 400);
      }

      // Simulate postback test - in production, send actual postback
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 300));
      const responseCode = 200;

      // Update network status
      await prisma.network.update({
        where: { id },
        data: {
          postbackHealthy: true,
          lastPostbackCheck: new Date(),
        },
      });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'TEST_POSTBACK',
          resource: 'Network',
          resourceId: id,
          changes: { responseCode, healthy: true },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        ok: true,
        responseCode,
      });
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

      const result = await prisma.$transaction(async (tx) => {
        let imported = 0;
        for (const row of rows) {
          // Check if network with this name exists
          const existing = await tx.network.findFirst({
            where: { name: row.name },
          });

          if (!existing) {
            await tx.network.create({
              data: {
                name: row.name,
                apiUrl: row.apiUrl || null,
                apiKey: row.apiKey || null,
                postbackUrl: row.postbackUrl || null,
                clickIdMapping: row.clickIdMapping || null,
                payoutMapping: row.payoutMapping || null,
                statusMapping: row.statusMapping || null,
                status: 'ACTIVE',
              },
            });
            imported++;
          }
        }
        return imported;
      });

      // Invalidate cache
      await cache.delPattern('networks:*');

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'BULK_IMPORT',
          resource: 'Network',
          changes: { imported: result },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        imported: result,
        total: rows.length,
        message: `Successfully imported ${result} networks`,
        skipped: rows.length - result,
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}