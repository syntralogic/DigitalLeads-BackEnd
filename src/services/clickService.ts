import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import { geoipUtils } from '../utils/geoip';
import { userAgentUtils } from '../utils/userAgent';
import { v4 as uuidv4 } from 'uuid';

export class ClickService {
  static async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    country?: string;
    device?: string;
    browser?: string;
    from?: Date;
    to?: Date;
    sort?: string;
  }) {
    const { page = 1, pageSize = 25, search, country, device, browser, from, to, sort = 'timestamp:desc' } = params;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = {};
    if (search) {
      where.OR = [
        { clickId: { contains: search, mode: 'insensitive' } },
        { ip: { contains: search, mode: 'insensitive' } },
        { campaign: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (country) where.country = country;
    if (device) where.device = { contains: device, mode: 'insensitive' };
    if (browser) where.browser = { contains: browser, mode: 'insensitive' };
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const [sortField, sortOrder] = sort.split(':');
    const orderBy: any = {};
    orderBy[sortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    const [clicks, total] = await Promise.all([
      prisma.click.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          offer: { select: { id: true, name: true } },
          network: { select: { id: true, name: true } },
          conversion: { select: { id: true, status: true, revenue: true } },
        },
      }),
      prisma.click.count({ where }),
    ]);

    return {
      data: clicks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async getById(id: string) {
    const click = await prisma.click.findUnique({
      where: { id },
      include: {
        offer: true,
        network: true,
        conversion: true,
      },
    });

    if (!click) {
      throw new Error('Click not found');
    }

    return click;
  }

  static async track(data: {
    offerId: string;
    networkId: string;
    ip: string;
    userAgent: string;
    referrer?: string;
    campaign?: string;
    sub1?: string;
    sub2?: string;
    sub3?: string;
    sub4?: string;
    sub5?: string;
    sub6?: string;
    sub7?: string;
    sub8?: string;
    sub9?: string;
    sub10?: string;
  }) {
    // Validate offer exists
    const offer = await prisma.offer.findUnique({
      where: { id: data.offerId },
      include: { network: true },
    });

    if (!offer) {
      throw new Error('Offer not found');
    }

    // Generate unique click ID
    const clickId = `cl_${uuidv4().replace(/-/g, '')}`;

    // Parse user agent
    const deviceInfo = userAgentUtils.parse(data.userAgent);

    // Get geo data
    const geoData = geoipUtils.getGeoData(data.ip);

    // Check for fraud
    const isFraudulent = await this.detectFraud(data);

    // Create click
    const click = await prisma.click.create({
      data: {
        clickId,
        ip: data.ip,
        country: geoData?.country || null,
        city: geoData?.city || null,
        device: deviceInfo.device,
        os: deviceInfo.os,
        browser: deviceInfo.browser,
        isp: null,
        carrier: null,
        referrer: data.referrer || null,
        campaign: data.campaign || null,
        sub1: data.sub1 || null,
        sub2: data.sub2 || null,
        sub3: data.sub3 || null,
        sub4: data.sub4 || null,
        sub5: data.sub5 || null,
        sub6: data.sub6 || null,
        sub7: data.sub7 || null,
        sub8: data.sub8 || null,
        sub9: data.sub9 || null,
        sub10: data.sub10 || null,
        offerId: data.offerId,
        networkId: data.networkId || offer.networkId,
        isFraudulent,
        userAgent: data.userAgent,
        sessionId: this.generateSessionId(data),
      },
    });

    // Update stats in Redis
    await this.updateStats(click);

    // Log fraud if detected
    if (isFraudulent) {
      await this.handleFraud(click, data);
    }

    return click;
  }

  private static async detectFraud(data: any): Promise<boolean> {
    // Check for duplicate clicks
    const duplicate = await prisma.click.findFirst({
      where: {
        ip: data.ip,
        offerId: data.offerId,
        timestamp: {
          gte: new Date(Date.now() - 60 * 1000), // 1 minute window
        },
      },
    });

    if (duplicate) return true;

    // Check for bot
    const deviceInfo = userAgentUtils.parse(data.userAgent);
    if (deviceInfo.isBot) return true;

    // Check for blacklisted IP
    const isBlacklisted = await cache.sismember('blacklist:ips', data.ip);
    if (isBlacklisted) return true;

    return false;
  }

  private static generateSessionId(data: any): string {
    const components = [
      data.ip,
      data.userAgent,
      new Date().toDateString(),
    ];
    return `sess_${Buffer.from(components.join('|')).toString('base64').substring(0, 20)}`;
  }

  private static async updateStats(click: any): Promise<void> {
    await cache.increment(`stats:clicks:${click.offerId}`);
    await cache.increment(`stats:clicks:${click.networkId}`);
    await cache.increment(`stats:clicks:today`);
    await cache.increment(`stats:clicks:total`);
  }

  private static async handleFraud(click: any, data: any): Promise<void> {
    await prisma.fraudSignal.create({
      data: {
        type: 'DUPLICATE_CLICK',
        label: 'Duplicate Click Detected',
        count: 1,
        riskLevel: 'HIGH',
        ipAddress: data.ip,
        details: JSON.stringify({
          offerId: data.offerId,
          networkId: data.networkId,
          clickId: click.id,
        }),
      },
    });

    // Publish fraud event
    await cache.redis.publish('fraud:detected', JSON.stringify({
      type: 'DUPLICATE_CLICK',
      ip: data.ip,
      offerId: data.offerId,
      clickId: click.id,
      timestamp: new Date().toISOString(),
    }));
  }

  static async export(params: any) {
    const { search, country, device, browser, from, to, format = 'csv' } = params;

    const where: any = {};
    if (search) {
      where.OR = [
        { clickId: { contains: search, mode: 'insensitive' } },
        { ip: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (country) where.country = country;
    if (device) where.device = { contains: device, mode: 'insensitive' };
    if (browser) where.browser = { contains: browser, mode: 'insensitive' };
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const clicks = await prisma.click.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      include: {
        offer: { select: { name: true } },
        network: { select: { name: true } },
      },
    });

    if (format === 'csv') {
      const headers = [
        'Click ID', 'IP', 'Country', 'City', 'Device', 'OS', 'Browser',
        'ISP', 'Carrier', 'Referrer', 'Campaign', 'Sub1', 'Sub2', 'Sub3',
        'Sub4', 'Sub5', 'Sub6', 'Sub7', 'Sub8', 'Sub9', 'Sub10',
        'Offer', 'Network', 'Is Fraudulent', 'Timestamp'
      ];

      const rows = clicks.map(click => [
        click.clickId, click.ip || '', click.country || '', click.city || '',
        click.device || '', click.os || '', click.browser || '',
        click.isp || '', click.carrier || '', click.referrer || '',
        click.campaign || '', click.sub1 || '', click.sub2 || '',
        click.sub3 || '', click.sub4 || '', click.sub5 || '',
        click.sub6 || '', click.sub7 || '', click.sub8 || '',
        click.sub9 || '', click.sub10 || '',
        click.offer?.name || '', click.network?.name || '',
        click.isFraudulent ? 'Yes' : 'No',
        click.timestamp.toISOString(),
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      return { content: csvContent, format: 'csv' };
    }

    return { data: clicks, format: 'json' };
  }
}