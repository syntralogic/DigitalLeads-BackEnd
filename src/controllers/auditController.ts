import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';

export class AuditController {
  static async getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        search,
        action,
        resource,
        from,
        to,
        sort = 'timestamp:desc',
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {};
      if (search) {
        where.OR = [
          { action: { contains: search as string, mode: 'insensitive' } },
          { resource: { contains: search as string, mode: 'insensitive' } },
          { resourceId: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (action) {
        where.action = action as string;
      }
      if (resource) {
        where.resource = resource as string;
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

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      const result = {
        data: logs,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      };

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
        action,
        resource,
        from,
        to,
        format = 'csv',
      } = req.query;

      const where: any = {};
      if (search) {
        where.OR = [
          { action: { contains: search as string, mode: 'insensitive' } },
          { resource: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (action) {
        where.action = action as string;
      }
      if (resource) {
        where.resource = resource as string;
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

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
      });

      if (format === 'csv') {
        const headers = [
          'Timestamp',
          'User',
          'Action',
          'Resource',
          'Resource ID',
          'IP',
          'User Agent',
          'Changes',
        ];

        const rows = logs.map(log => [
          log.timestamp.toISOString(),
          log.user?.email || 'System',
          log.action,
          log.resource,
          log.resourceId || '',
          log.ip || '',
          log.userAgent || '',
          JSON.stringify(log.changes || {}),
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${Date.now()}.csv`);
        res.send(csvContent);
        return;
      }

      res.json({
        data: logs,
        total: logs.length,
        exportedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}