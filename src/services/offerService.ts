import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import { OfferStatus } from '@prisma/client';

export class OfferService {
  static async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: OfferStatus;
    category?: string;
    country?: string;
    sort?: string;
  }) {
    const { page = 1, pageSize = 25, search, status, category, country, sort = 'createdAt:desc' } = params;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (category) where.category = category;
    if (country) where.country = country;

    const [sortField, sortOrder] = sort.split(':');
    const orderBy: any = {};
    orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    const [offers, total] = await Promise.all([
      prisma.offer.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          network: { select: { id: true, name: true } },
          _count: { select: { clicks: true, conversions: true } },
        },
      }),
      prisma.offer.count({ where }),
    ]);

    return {
      data: offers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async getById(id: string) {
    const offer = await prisma.offer.findUnique({
      where: { id },
      include: {
        network: true,
        _count: { select: { clicks: true, conversions: true } },
      },
    });

    if (!offer) {
      throw new Error('Offer not found');
    }

    return offer;
  }

  static async create(data: {
    name: string;
    category?: string;
    country?: string;
    deviceTargeting?: string;
    browserTargeting?: string;
    payout?: number;
    dailyCap?: number;
    hourlyCap?: number;
    startDate?: Date;
    endDate?: Date;
    networkId: string;
  }) {
    // Check network exists
    const network = await prisma.network.findUnique({
      where: { id: data.networkId },
    });

    if (!network) {
      throw new Error('Network not found');
    }

    // Check duplicate
    const existing = await prisma.offer.findFirst({
      where: {
        name: data.name,
        networkId: data.networkId,
      },
    });

    if (existing) {
      throw new Error('Offer with this name already exists for this network');
    }

    return prisma.offer.create({
      data: {
        ...data,
        status: 'ACTIVE',
        previewLink: `/preview/${Buffer.from(data.name).toString('base64')}`,
      },
    });
  }

  static async update(id: string, data: {
    name?: string;
    category?: string;
    country?: string;
    deviceTargeting?: string;
    browserTargeting?: string;
    payout?: number;
    dailyCap?: number;
    hourlyCap?: number;
    startDate?: Date;
    endDate?: Date;
    networkId?: string;
    status?: OfferStatus;
  }) {
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Offer not found');
    }

    // Check name conflict
    if (data.name && data.name !== existing.name) {
      const conflict = await prisma.offer.findFirst({
        where: {
          name: data.name,
          networkId: data.networkId || existing.networkId,
          NOT: { id },
        },
      });
      if (conflict) {
        throw new Error('Offer name already in use');
      }
    }

    return prisma.offer.update({
      where: { id },
      data,
    });
  }

  static async delete(id: string) {
    const existing = await prisma.offer.findUnique({
      where: { id },
      include: {
        clicks: { take: 1 },
        conversions: { take: 1 },
      },
    });

    if (!existing) {
      throw new Error('Offer not found');
    }

    if (existing.clicks.length > 0 || existing.conversions.length > 0) {
      throw new Error('Cannot delete offer with associated clicks or conversions');
    }

    return prisma.offer.delete({ where: { id } });
  }

  static async clone(id: string) {
    const original = await prisma.offer.findUnique({ where: { id } });
    if (!original) {
      throw new Error('Offer not found');
    }

    return prisma.offer.create({
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
  }

  static async setStatus(id: string, status: OfferStatus) {
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Offer not found');
    }

    return prisma.offer.update({
      where: { id },
      data: { status },
    });
  }

  static async bulkImport(rows: any[]) {
    let imported = 0;
    for (const row of rows) {
      const network = await prisma.network.findUnique({
        where: { id: row.networkId },
      });

      if (!network) continue;

      const existing = await prisma.offer.findFirst({
        where: {
          name: row.name,
          networkId: row.networkId,
        },
      });

      if (!existing) {
        await prisma.offer.create({
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
        imported++;
      }
    }
    return imported;
  }

  static async getPreview(id: string) {
    const offer = await prisma.offer.findUnique({
      where: { id },
      include: { network: true },
    });

    if (!offer) {
      throw new Error('Offer not found');
    }

    return offer;
  }
}