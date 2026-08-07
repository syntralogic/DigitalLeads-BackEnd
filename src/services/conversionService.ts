import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import { ConversionStatus } from '@prisma/client';

export class ConversionService {
  static async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: ConversionStatus;
    offer?: string;
    network?: string;
    from?: Date;
    to?: Date;
    sort?: string;
  }) {
    const { page = 1, pageSize = 25, search, status, offer, network, from, to, sort = 'timestamp:desc' } = params;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = {};
    if (search) {
      where.OR = [
        { conversionId: { contains: search, mode: 'insensitive' } },
        { ip: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (offer) where.offerId = offer;
    if (network) where.networkId = network;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const [sortField, sortOrder] = sort.split(':');
    const orderBy: any = {};
    orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    const [conversions, total] = await Promise.all([
      prisma.conversion.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          offer: { select: { id: true, name: true } },
          network: { select: { id: true, name: true } },
          click: { select: { clickId: true, country: true, device: true, browser: true } },
        },
      }),
      prisma.conversion.count({ where }),
    ]);

    return {
      data: conversions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async getById(id: string) {
    const conversion = await prisma.conversion.findUnique({
      where: { id },
      include: {
        offer: true,
        network: true,
        click: true,
      },
    });

    if (!conversion) {
      throw new Error('Conversion not found');
    }

    return conversion;
  }

  static async create(data: {
    conversionId: string;
    offerId: string;
    networkId: string;
    clickId?: string;
    revenue?: number;
    payout?: number;
    status?: ConversionStatus;
    country?: string;
    device?: string;
    browser?: string;
    ip?: string;
    userAgent?: string;
  }) {
    // Validate offer
    const offer = await prisma.offer.findUnique({
      where: { id: data.offerId },
    });

    if (!offer) {
      throw new Error('Offer not found');
    }

    // Validate network
    const network = await prisma.network.findUnique({
      where: { id: data.networkId },
    });

    if (!network) {
      throw new Error('Network not found');
    }

    // Check duplicate conversion ID
    const existing = await prisma.conversion.findUnique({
      where: { conversionId: data.conversionId },
    });

    if (existing) {
      throw new Error('Conversion ID already exists');
    }

    const conversion = await prisma.conversion.create({
      data: {
        ...data,
        status: data.status || 'PENDING',
      },
    });

    // Update click with conversion info
    if (data.clickId) {
      await prisma.click.update({
        where: { clickId: data.clickId },
        data: {
          conversion: {
            connect: { id: conversion.id },
          },
        },
      });
    }

    // Update stats in Redis
    await this.updateStats(conversion);

    return conversion;
  }

  static async setStatus(id: string, status: ConversionStatus) {
    const existing = await prisma.conversion.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error('Conversion not found');
    }

    const conversion = await prisma.conversion.update({
      where: { id },
      data: { status },
    });

    // If approved, update click revenue
    if (status === 'APPROVED' && existing.status !== 'APPROVED') {
      if (existing.clickId) {
        await prisma.click.update({
          where: { clickId: existing.clickId },
          data: {
            revenue: existing.revenue || 0,
          },
        });
      }
    }

    return conversion;
  }

  static async getTimeline(params: {
    offer?: string;
    network?: string;
    from?: Date;
    to?: Date;
    granularity?: 'hour' | 'day' | 'week' | 'month';
  }) {
    const { offer, network, from, to, granularity = 'day' } = params;

    const where: any = {};
    if (offer) where.offerId = offer;
    if (network) where.networkId = network;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

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

    const timeline = await prisma.$queryRaw`
      SELECT 
        ${groupBy} as time_bucket,
        COUNT(*) as count,
        COALESCE(SUM(revenue), 0) as revenue,
        COALESCE(SUM(payout), 0) as payout
      FROM "conversions"
      WHERE 1=1
        ${offer ? prisma.$raw`AND offer_id = ${offer}` : prisma.$raw``}
        ${network ? prisma.$raw`AND network_id = ${network}` : prisma.$raw``}
        ${from ? prisma.$raw`AND timestamp >= ${from}` : prisma.$raw``}
        ${to ? prisma.$raw`AND timestamp <= ${to}` : prisma.$raw``}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `;

    return (timeline as any[]).map(item => ({
      timestamp: item.time_bucket.toISOString(),
      value: Number(item.count),
      revenue: Number(item.revenue),
      payout: Number(item.payout),
    }));
  }

  private static async updateStats(conversion: any): Promise<void> {
    await cache.increment(`stats:conversions:${conversion.offerId}`);
    await cache.increment(`stats:conversions:${conversion.networkId}`);
    await cache.increment(`stats:conversions:today`);
    await cache.increment(`stats:conversions:total`);
    
    if (conversion.revenue) {
      await cache.increment(`stats:revenue:${conversion.offerId}`);
      await cache.increment(`stats:revenue:${conversion.networkId}`);
      await cache.increment(`stats:revenue:today`);
      await cache.increment(`stats:revenue:total`);
    }
  }

  static async export(params: any) {
    const { search, status, offer, network, from, to, format = 'csv' } = params;

    const where: any = {};
    if (search) {
      where.OR = [
        { conversionId: { contains: search, mode: 'insensitive' } },
        { ip: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (offer) where.offerId = offer;
    if (network) where.networkId = network;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const conversions = await prisma.conversion.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      include: {
        offer: { select: { name: true } },
        network: { select: { name: true } },
      },
    });

    if (format === 'csv') {
      const headers = [
        'Conversion ID', 'Offer', 'Network', 'Revenue', 'Payout',
        'Status', 'Country', 'Device', 'Browser', 'IP',
        'Is Fraudulent', 'Timestamp'
      ];

      const rows = conversions.map(conv => [
        conv.conversionId, conv.offer?.name || '', conv.network?.name || '',
        conv.revenue || '', conv.payout || '', conv.status,
        conv.country || '', conv.device || '', conv.browser || '',
        conv.ip || '', conv.isFraudulent ? 'Yes' : 'No',
        conv.timestamp.toISOString(),
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      return { content: csvContent, format: 'csv' };
    }

    return { data: conversions, format: 'json' };
  }
}