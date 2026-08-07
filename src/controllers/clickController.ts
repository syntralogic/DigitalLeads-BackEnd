import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { ClickProcessor } from '../workers/clickProcessor';

export class ClickController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        search,
        country,
        device,
        browser,
        from,
        to,
        sort = 'timestamp:desc',
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {};
      if (search) {
        where.OR = [
          { clickId: { contains: search as string, mode: 'insensitive' } },
          { ip: { contains: search as string, mode: 'insensitive' } },
          { campaign: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (country) {
        where.country = country as string;
      }
      if (device) {
        where.device = { contains: device as string, mode: 'insensitive' };
      }
      if (browser) {
        where.browser = { contains: browser as string, mode: 'insensitive' };
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

      const cacheKey = `clicks:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const [clicks, total] = await Promise.all([
        prisma.click.findMany({
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
            conversion: {
              select: {
                id: true,
                status: true,
                revenue: true,
              },
            },
          },
        }),
        prisma.click.count({ where }),
      ]);

      const result = {
        data: clicks,
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

      const click = await prisma.click.findUnique({
        where: { id },
        include: {
          offer: true,
          network: true,
          conversion: true,
        },
      });

      if (!click) {
        throw new AppError('Click not found', 404);
      }

      res.json(click);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async track(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        offerId,
        networkId,
        ip,
        userAgent,
        referrer,
        campaign,
        sub1,
        sub2,
        sub3,
        sub4,
        sub5,
        sub6,
        sub7,
        sub8,
        sub9,
        sub10,
      } = req.body;

      // Get real IP if behind proxy
      const realIp = ip || req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';

      // Validate offer exists
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: { network: true },
      });

      if (!offer) {
        throw new AppError('Offer not found', 404);
      }

      // Process click
      const clickId = await ClickProcessor.process({
        offerId,
        networkId: networkId || offer.networkId,
        ip: realIp as string,
        userAgent: userAgent || req.headers['user-agent'] || 'Unknown',
        referrer: referrer || req.headers['referer'] || req.headers['referrer'],
        campaign,
        sub1,
        sub2,
        sub3,
        sub4,
        sub5,
        sub6,
        sub7,
        sub8,
        sub9,
        sub10,
      });

      // Prepare redirect
      let redirectUrl = '/';
      if (offer.previewLink) {
        redirectUrl = offer.previewLink;
      }

      res.json({
        success: true,
        clickId,
        redirectUrl,
        message: 'Click tracked successfully',
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        search,
        country,
        device,
        browser,
        from,
        to,
        format = 'csv',
      } = req.query;

      const where: any = {};
      if (search) {
        where.OR = [
          { clickId: { contains: search as string, mode: 'insensitive' } },
          { ip: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (country) {
        where.country = country as string;
      }
      if (device) {
        where.device = { contains: device as string, mode: 'insensitive' };
      }
      if (browser) {
        where.browser = { contains: browser as string, mode: 'insensitive' };
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

      const clicks = await prisma.click.findMany({
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

      // Generate CSV
      if (format === 'csv') {
        const headers = [
          'Click ID',
          'IP',
          'Country',
          'City',
          'Device',
          'OS',
          'Browser',
          'ISP',
          'Carrier',
          'Referrer',
          'Campaign',
          'Sub1',
          'Sub2',
          'Sub3',
          'Sub4',
          'Sub5',
          'Sub6',
          'Sub7',
          'Sub8',
          'Sub9',
          'Sub10',
          'Offer',
          'Network',
          'Is Fraudulent',
          'Timestamp',
        ];

        const rows = clicks.map(click => [
          click.clickId,
          click.ip || '',
          click.country || '',
          click.city || '',
          click.device || '',
          click.os || '',
          click.browser || '',
          click.isp || '',
          click.carrier || '',
          click.referrer || '',
          click.campaign || '',
          click.sub1 || '',
          click.sub2 || '',
          click.sub3 || '',
          click.sub4 || '',
          click.sub5 || '',
          click.sub6 || '',
          click.sub7 || '',
          click.sub8 || '',
          click.sub9 || '',
          click.sub10 || '',
          click.offer?.name || '',
          click.network?.name || '',
          click.isFraudulent ? 'Yes' : 'No',
          click.timestamp.toISOString(),
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=clicks_${Date.now()}.csv`);
        res.send(csvContent);
        return;
      }

      // Export as JSON
      res.json({
        data: clicks,
        total: clicks.length,
        exportedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}