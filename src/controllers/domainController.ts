import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import dns from 'dns';
import https from 'https';
import tls from 'tls';

export class DomainController {
  static async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'domains:list';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const domains = await prisma.domain.findMany({
        orderBy: { createdAt: 'desc' },
      });

      await cache.set(cacheKey, domains, 60);
      res.json(domains);
      return;
    } catch (error) {
      console.error('List domains error:', error);
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { domain, type, status } = req.body;

      // Check if domain already exists
      const existing = await prisma.domain.findUnique({
        where: { domain },
      });

      if (existing) {
        throw new AppError('Domain already exists', 409);
      }

      const newDomain = await prisma.domain.create({
        data: {
          domain,
          type,
          status: status || 'PENDING',
        },
      });

      await cache.delPattern('domains:list');

      // Verify domain asynchronously - using the static method properly
      // Don't await this - let it run in background
      DomainController.verifyDomain(newDomain.id, domain).catch(error => {
        console.error('Background domain verification error:', error);
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE',
          resource: 'Domain',
          resourceId: newDomain.id,
          changes: { domain: newDomain },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json(newDomain);
      return;
    } catch (error) {
      console.error('Create domain error:', error);
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { domain, type, status } = req.body;

      const existing = await prisma.domain.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Domain not found', 404);
      }

      // Check if new domain conflicts
      if (domain && domain !== existing.domain) {
        const conflict = await prisma.domain.findFirst({
          where: {
            domain,
            NOT: { id },
          },
        });
        if (conflict) {
          throw new AppError('Domain already exists', 409);
        }
      }

      const updated = await prisma.domain.update({
        where: { id },
        data: {
          domain,
          type,
          status,
        },
      });

      await cache.delPattern('domains:list');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'Domain',
          resourceId: id,
          changes: { before: existing, after: updated },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(updated);
      return;
    } catch (error) {
      console.error('Update domain error:', error);
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const existing = await prisma.domain.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Domain not found', 404);
      }

      await prisma.domain.delete({
        where: { id },
      });

      await cache.delPattern('domains:list');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DELETE',
          resource: 'Domain',
          resourceId: id,
          changes: { domain: existing },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(204).send();
      return;
    } catch (error) {
      console.error('Delete domain error:', error);
      next(error);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existing = await prisma.domain.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError('Domain not found', 404);
      }

      const updated = await prisma.domain.update({
        where: { id },
        data: { status },
      });

      await cache.delPattern('domains:list');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE_STATUS',
          resource: 'Domain',
          resourceId: id,
          changes: { before: existing.status, after: status },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(updated);
      return;
    } catch (error) {
      console.error('Set status error:', error);
      next(error);
    }
  }

  static async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const domain = await prisma.domain.findUnique({
        where: { id },
      });

      if (!domain) {
        throw new AppError('Domain not found', 404);
      }

      // Await the verification
      const result = await DomainController.verifyDomain(id, domain.domain);

      // Get the updated domain
      const updatedDomain = await prisma.domain.findUnique({
        where: { id },
      });

      res.json({
        success: result,
        domain: domain.domain,
        sslStatus: updatedDomain?.sslStatus,
        dnsStatus: updatedDomain?.dnsStatus,
        health: updatedDomain?.health,
        status: updatedDomain?.status,
      });
      return;
    } catch (error) {
      console.error('Verify domain error:', error);
      next(error);
    }
  }

  // Make this a static method
  private static async verifyDomain(id: string, domain: string): Promise<boolean> {
    try {
      console.log(`Verifying domain: ${domain}`);
      
      // Check DNS
      const dnsStatus = await DomainController.checkDNS(domain);
      console.log(`DNS check for ${domain}: ${dnsStatus}`);
      
      // Check SSL
      const sslStatus = await DomainController.checkSSL(domain);
      console.log(`SSL check for ${domain}: ${sslStatus}`);

      // Determine overall health
      const isHealthy = dnsStatus && sslStatus;
      const healthStatus = isHealthy ? 'healthy' : 'unhealthy';
      const domainStatus = isHealthy ? 'ACTIVE' : 'PENDING';

      // Update domain status
      await prisma.domain.update({
        where: { id },
        data: {
          dnsStatus: dnsStatus ? 'ok' : 'error',
          sslStatus: sslStatus ? 'valid' : 'invalid',
          health: healthStatus,
          status: domainStatus as any,
        },
      });

      await cache.delPattern('domains:list');

      console.log(`Domain ${domain} verification completed: ${isHealthy}`);
      return isHealthy;
    } catch (error) {
      console.error('Domain verification error:', { domain, error });
      
      // Update with failed status
      await prisma.domain.update({
        where: { id },
        data: {
          dnsStatus: 'error',
          sslStatus: 'invalid',
          health: 'unhealthy',
          status: 'PENDING' as any,
        },
      });
      
      return false;
    }
  }

  private static checkDNS(domain: string): Promise<boolean> {
    return new Promise((resolve) => {
      dns.resolve4(domain, (err) => {
        if (err) {
          console.log(`DNS resolve error for ${domain}:`, err.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  private static checkSSL(domain: string): Promise<boolean> {
    return new Promise((resolve) => {
      const options = {
        host: domain,
        port: 443,
        method: 'HEAD',
        timeout: 5000,
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        // Check if connection is secure
        const socket = res.socket;
        if (socket && 'authorized' in socket) {
          resolve((socket as tls.TLSSocket).authorized || false);
        } else {
          resolve(false);
        }
      });

      req.on('error', (err) => {
        console.log(`SSL check error for ${domain}:`, err.message);
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        console.log(`SSL check timeout for ${domain}`);
        resolve(false);
      });

      req.end();
    });
  }
}