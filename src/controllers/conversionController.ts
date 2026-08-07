import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { ConversionStatus } from '@prisma/client';

export class ConversionController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        search,
        status,
        offer,
        network,
        from,
        to,
        sort = 'timestamp:desc',
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {};
      if (search) {
        where.OR = [
          { conversionId: { contains: search as string, mode: 'insensitive' } },
          { ip: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (status) {
        where.status = status as ConversionStatus;
      }
      if (offer) {
        where.offerId = offer as string;
      }
      if (network) {
        where.networkId = network as string;
      }
      if (from || to) {
        where.timestamp = {};
        if (from) {
          where.timestamp.gte = new Date(from as string);
        }
        if (to) {
          where.timestamp.lte = new Date(to as string);
        }
      }

      const [sortField, sortOrder] = (sort as string).split(':');
      const orderBy: any = {};
      orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

      const cacheKey = `conversions:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const [conversions, total] = await Promise.all([
        prisma.conversion.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            offer: {
              select: {
                id: true,
                name: true,
              },
            },
            network: {
              select: {
                id: true,
                name: true,
              },
            },
            click: {
              select: {
                clickId: true,
                country: true,
                device: true,
                browser: true,
              },
            },
          },
        }),
        prisma.conversion.count({ where }),
      ]);

      const result = {
        data: conversions,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      };

      await cache.set(cacheKey, result, 30);
      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const conversion = await prisma.conversion.findUnique({
        where: { id },
        include: {
          offer: true,
          network: true,
          click: true,
        },
      });

      if (!conversion) {
        throw new AppError('Conversion not found', 404);
      }

      res.json(conversion);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        conversionId,
        offerId,
        networkId,
        clickId,
        revenue,
        payout,
        status,
        country,
        device,
        browser,
        ip,
        userAgent,
      } = req.body;

      // Validate offer exists
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!offer) {
        throw new AppError('Offer not found', 404);
      }

      // Validate network exists
      const network = await prisma.network.findUnique({
        where: { id: networkId },
      });

      if (!network) {
        throw new AppError('Network not found', 404);
      }

      // Generate unique conversion ID if not provided or if it already exists
      let finalConversionId = conversionId;
      if (!finalConversionId) {
        finalConversionId = `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      } else {
        // Check if conversion ID already exists
        const existing = await prisma.conversion.findUnique({
          where: { conversionId: finalConversionId },
        });
        if (existing) {
          // If duplicate, generate a new one
          finalConversionId = `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        }
      }

      const conversion = await prisma.conversion.create({
        data: {
          conversionId: finalConversionId,
          offerId,
          networkId,
          clickId,
          revenue: revenue || 0,
          payout: payout || 0,
          status: status as ConversionStatus || 'PENDING',
          country: country || null,
          device: device || null,
          browser: browser || null,
          ip: ip || null,
          userAgent: userAgent || null,
        },
      });

      await cache.delPattern('conversions:*');

      // Update click with conversion info
      if (clickId) {
        await prisma.click.update({
          where: { clickId },
          data: {
            conversion: {
              connect: { id: conversion.id },
            },
          },
        });
      }

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE',
          resource: 'Conversion',
          resourceId: conversion.id,
          changes: { conversion },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json(conversion);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existing = await prisma.conversion.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Conversion not found', 404);
      }

      const conversion = await prisma.conversion.update({
        where: { id },
        data: { status: status as ConversionStatus },
      });

      await cache.delPattern(`conversion:${id}`);
      await cache.delPattern('conversions:*');

      // If approved, update revenue
      if (status === 'APPROVED' && existing.status !== 'APPROVED') {
        // Update click revenue
        if (existing.clickId) {
          await prisma.click.update({
            where: { clickId: existing.clickId },
            data: {
              revenue: existing.revenue || 0,
            },
          });
        }
      }

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE_STATUS',
          resource: 'Conversion',
          resourceId: id,
          changes: { before: existing.status, after: status },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(conversion);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        offer,
        network,
        from,
        to,
        granularity = 'day',
      } = req.query;

      const where: any = {};
      if (offer) {
        where.offerId = offer as string;
      }
      if (network) {
        where.networkId = network as string;
      }
      if (from || to) {
        where.timestamp = {};
        if (from) {
          where.timestamp.gte = new Date(from as string);
        }
        if (to) {
          where.timestamp.lte = new Date(to as string);
        }
      }

      const cacheKey = `conversions:timeline:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      // Build timeline query based on granularity
      let groupBy: string;
      switch (granularity) {
        case 'hour':
          groupBy = "DATE_TRUNC('hour', timestamp)";
          break;
        case 'day':
          groupBy = "DATE_TRUNC('day', timestamp)";
          break;
        case 'week':
          groupBy = "DATE_TRUNC('week', timestamp)";
          break;
        case 'month':
          groupBy = "DATE_TRUNC('month', timestamp)";
          break;
        default:
          groupBy = "DATE_TRUNC('day', timestamp)";
      }

      // Build the query with proper SQL
      let sql = `
        SELECT 
          ${groupBy} as time_bucket,
          COUNT(*) as count,
          COALESCE(SUM(revenue), 0) as revenue,
          COALESCE(SUM(payout), 0) as payout
        FROM "conversions"
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (offer) {
        sql += ` AND offer_id = $${paramIndex}`;
        params.push(offer);
        paramIndex++;
      }
      if (network) {
        sql += ` AND network_id = $${paramIndex}`;
        params.push(network);
        paramIndex++;
      }
      if (from) {
        sql += ` AND timestamp >= $${paramIndex}`;
        params.push(new Date(from as string));
        paramIndex++;
      }
      if (to) {
        sql += ` AND timestamp <= $${paramIndex}`;
        params.push(new Date(to as string));
        paramIndex++;
      }

      sql += ` GROUP BY time_bucket ORDER BY time_bucket ASC`;

      const timeline = await prisma.$queryRawUnsafe(sql, ...params);

      const result = (timeline as any[]).map(item => ({
        timestamp: item.time_bucket.toISOString(),
        value: Number(item.count),
        revenue: Number(item.revenue),
        payout: Number(item.payout),
      }));

      await cache.set(cacheKey, result, 60);
      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        search,
        status,
        offer,
        network,
        from,
        to,
        format = 'csv',
      } = req.query;

      const where: any = {};
      if (search) {
        where.OR = [
          { conversionId: { contains: search as string, mode: 'insensitive' } },
          { ip: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (status) {
        where.status = status as ConversionStatus;
      }
      if (offer) {
        where.offerId = offer as string;
      }
      if (network) {
        where.networkId = network as string;
      }
      if (from || to) {
        where.timestamp = {};
        if (from) {
          where.timestamp.gte = new Date(from as string);
        }
        if (to) {
          where.timestamp.lte = new Date(to as string);
        }
      }

      const conversions = await prisma.conversion.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        include: {
          offer: {
            select: { name: true },
          },
          network: {
            select: { name: true },
          },
        },
      });

      if (format === 'csv') {
        const headers = [
          'Conversion ID',
          'Offer',
          'Network',
          'Revenue',
          'Payout',
          'Status',
          'Country',
          'Device',
          'Browser',
          'IP',
          'Is Fraudulent',
          'Timestamp',
        ];

        const rows = conversions.map(conv => [
          conv.conversionId,
          conv.offer?.name || '',
          conv.network?.name || '',
          conv.revenue || '',
          conv.payout || '',
          conv.status,
          conv.country || '',
          conv.device || '',
          conv.browser || '',
          conv.ip || '',
          conv.isFraudulent ? 'Yes' : 'No',
          conv.timestamp.toISOString(),
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=conversions_${Date.now()}.csv`);
        res.send(csvContent);
        return;
      }

      res.json({
        data: conversions,
        total: conversions.length,
        exportedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}