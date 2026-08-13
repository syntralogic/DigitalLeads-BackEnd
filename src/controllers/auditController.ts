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

      // Ensure page and pageSize are valid numbers
      const pageNum = Math.max(1, Number(page) || 1);
      const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 25));
      const skip = (pageNum - 1) * pageSizeNum;
      const take = pageSizeNum;

      const where: any = {};
      
      // Only add filters if they exist and are not empty strings
      if (search && typeof search === 'string' && search.trim()) {
        where.OR = [
          { action: { contains: search.trim(), mode: 'insensitive' } },
          { resource: { contains: search.trim(), mode: 'insensitive' } },
          { resourceId: { contains: search.trim(), mode: 'insensitive' } },
        ];
      }
      
      if (action && typeof action === 'string' && action.trim()) {
        where.action = action.trim();
      }
      
      if (resource && typeof resource === 'string' && resource.trim()) {
        where.resource = resource.trim();
      }
      
      if (from || to) {
        where.timestamp = {};
        if (from && typeof from === 'string') {
          const fromDate = new Date(from);
          if (!isNaN(fromDate.getTime())) {
            where.timestamp.gte = fromDate;
          }
        }
        if (to && typeof to === 'string') {
          const toDate = new Date(to);
          if (!isNaN(toDate.getTime())) {
            where.timestamp.lte = toDate;
          }
        }
      }

      // Parse sort
      let orderBy: any = { timestamp: 'desc' };
      if (sort && typeof sort === 'string') {
        const [sortField, sortOrder] = sort.split(':');
        if (sortField && ['timestamp', 'action', 'resource'].includes(sortField)) {
          orderBy = {};
          orderBy[sortField] = sortOrder === 'asc' ? 'asc' : 'desc';
        }
      }

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
          page: pageNum,
          pageSize: pageSizeNum,
          total,
          totalPages: Math.ceil(total / pageSizeNum),
        },
      };

      res.json(result);
      return;
    } catch (error) {
      console.error('Audit logs error:', error);
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
      
      if (search && typeof search === 'string' && search.trim()) {
        where.OR = [
          { action: { contains: search.trim(), mode: 'insensitive' } },
          { resource: { contains: search.trim(), mode: 'insensitive' } },
        ];
      }
      
      if (action && typeof action === 'string' && action.trim()) {
        where.action = action.trim();
      }
      
      if (resource && typeof resource === 'string' && resource.trim()) {
        where.resource = resource.trim();
      }
      
      if (from || to) {
        where.timestamp = {};
        if (from && typeof from === 'string') {
          const fromDate = new Date(from);
          if (!isNaN(fromDate.getTime())) {
            where.timestamp.gte = fromDate;
          }
        }
        if (to && typeof to === 'string') {
          const toDate = new Date(to);
          if (!isNaN(toDate.getTime())) {
            where.timestamp.lte = toDate;
          }
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
      console.error('Audit export error:', error);
      next(error);
    }
  }
}