import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

export class SearchController {
  static async global(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { q } = req.query;

      if (!q || typeof q !== 'string' || q.length < 2) {
        throw new AppError('Search query must be at least 2 characters', 400);
      }

      const cacheKey = `search:${q}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      // Search in multiple resources
      const [networks, offers, clicks, conversions] = await Promise.all([
        // Search networks
        prisma.network.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { apiUrl: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: {
            id: true,
            name: true,
          },
        }),
        // Search offers
        prisma.offer.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
              { country: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: {
            id: true,
            name: true,
            network: {
              select: {
                name: true,
              },
            },
          },
        }),
        // Search clicks
        prisma.click.findMany({
          where: {
            OR: [
              { clickId: { contains: q, mode: 'insensitive' } },
              { ip: { contains: q, mode: 'insensitive' } },
              { country: { contains: q, mode: 'insensitive' } },
              { campaign: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: {
            id: true,
            clickId: true,
            country: true,
            offer: {
              select: {
                name: true,
              },
            },
          },
        }),
        // Search conversions
        prisma.conversion.findMany({
          where: {
            OR: [
              { conversionId: { contains: q, mode: 'insensitive' } },
              { ip: { contains: q, mode: 'insensitive' } },
              { country: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: {
            id: true,
            conversionId: true,
            status: true,
            offer: {
              select: {
                name: true,
              },
            },
          },
        }),
      ]);

      const results = [
        ...networks.map(n => ({
          id: n.id,
          type: 'network' as const,
          label: n.name,
          href: `/networks/${n.id}`,
          description: 'Network',
        })),
        ...offers.map(o => ({
          id: o.id,
          type: 'offer' as const,
          label: o.name,
          href: `/offers/${o.id}`,
          description: `Network: ${o.network?.name || 'Unknown'}`,
        })),
        ...clicks.map(c => ({
          id: c.id,
          type: 'click' as const,
          label: c.clickId,
          href: `/clicks/${c.id}`,
          description: `${c.country || 'Unknown'} - ${c.offer?.name || 'Unknown Offer'}`,
        })),
        ...conversions.map(c => ({
          id: c.id,
          type: 'conversion' as const,
          label: c.conversionId,
          href: `/conversions/${c.id}`,
          description: `${c.status} - ${c.offer?.name || 'Unknown Offer'}`,
        })),
      ];

      // Sort results by type priority
      const typePriority = { network: 1, offer: 2, click: 3, conversion: 4 };
      results.sort((a, b) => (typePriority[a.type] || 5) - (typePriority[b.type] || 5));

      await cache.set(cacheKey, results, 60);

      res.json(results);
      return;
    } catch (error) {
      next(error);
    }
  }
}