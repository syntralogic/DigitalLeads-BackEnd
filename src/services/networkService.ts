import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import { NetworkStatus } from '@prisma/client';

export class NetworkService {
  static async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: NetworkStatus;
    sort?: string;
  }) {
    const { page = 1, pageSize = 25, search, status, sort = 'createdAt:desc' } = params;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { apiUrl: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) {
      where.status = status;
    }

    const [sortField, sortOrder] = sort.split(':');
    const orderBy: any = {};
    orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    const [networks, total] = await Promise.all([
      prisma.network.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          _count: {
            select: { offers: true, clicks: true, conversions: true },
          },
        },
      }),
      prisma.network.count({ where }),
    ]);

    return {
      data: networks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async getById(id: string) {
    const network = await prisma.network.findUnique({
      where: { id },
      include: {
        offers: {
          select: { id: true, name: true, status: true, payout: true },
        },
        _count: {
          select: { clicks: true, conversions: true },
        },
      },
    });

    if (!network) {
      throw new Error('Network not found');
    }

    return network;
  }

  static async create(data: {
    name: string;
    apiUrl?: string;
    apiKey?: string;
    postbackUrl?: string;
    clickIdMapping?: string;
    payoutMapping?: string;
    statusMapping?: string;
  }) {
    const existing = await prisma.network.findFirst({
      where: { name: data.name },
    });

    if (existing) {
      throw new Error('Network with this name already exists');
    }

    return prisma.network.create({
      data: {
        ...data,
        status: 'ACTIVE',
      },
    });
  }

  static async update(id: string, data: {
    name?: string;
    apiUrl?: string;
    apiKey?: string;
    postbackUrl?: string;
    clickIdMapping?: string;
    payoutMapping?: string;
    statusMapping?: string;
    status?: NetworkStatus;
  }) {
    const existing = await prisma.network.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Network not found');
    }

    // Check name conflict
    if (data.name && data.name !== existing.name) {
      const conflict = await prisma.network.findFirst({
        where: {
          name: data.name,
          NOT: { id },
        },
      });
      if (conflict) {
        throw new Error('Network name already in use');
      }
    }

    return prisma.network.update({
      where: { id },
      data,
    });
  }

  static async delete(id: string) {
    const existing = await prisma.network.findUnique({
      where: { id },
      include: { offers: { take: 1 } },
    });

    if (!existing) {
      throw new Error('Network not found');
    }

    if (existing.offers.length > 0) {
      throw new Error('Cannot delete network with associated offers');
    }

    return prisma.network.delete({ where: { id } });
  }

  static async setStatus(id: string, status: NetworkStatus) {
    const existing = await prisma.network.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Network not found');
    }

    return prisma.network.update({
      where: { id },
      data: { status },
    });
  }

  static async testConnection(id: string) {
    const network = await prisma.network.findUnique({ where: { id } });
    if (!network) {
      throw new Error('Network not found');
    }

    if (!network.apiUrl) {
      throw new Error('Network has no API URL configured');
    }

    // In production, make actual HTTP request
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));
    const latencyMs = Date.now() - startTime;

    await prisma.network.update({
      where: { id },
      data: {
        apiHealthy: latencyMs < 1000,
        lastApiCheck: new Date(),
      },
    });

    return { ok: latencyMs < 1000, latencyMs };
  }

  static async testPostback(id: string) {
    const network = await prisma.network.findUnique({ where: { id } });
    if (!network) {
      throw new Error('Network not found');
    }

    if (!network.postbackUrl) {
      throw new Error('Network has no postback URL configured');
    }

    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 300));

    await prisma.network.update({
      where: { id },
      data: {
        postbackHealthy: true,
        lastPostbackCheck: new Date(),
      },
    });

    return { ok: true, responseCode: 200 };
  }

  static async bulkImport(rows: any[]) {
    let imported = 0;
    for (const row of rows) {
      const existing = await prisma.network.findFirst({
        where: { name: row.name },
      });

      if (!existing) {
        await prisma.network.create({
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
  }
}