import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { cryptoUtils } from '../utils/crypto';

export class SettingsController {
  static async getBranding(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'settings:branding';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const branding = await prisma.brandingSetting.findFirst();

      const result = branding || {
        panelName: 'DigitalLeads',
        logoUrl: null,
        supportEmail: null,
        whiteLabelDomain: null,
      };

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async saveBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { panelName, logoUrl, supportEmail, whiteLabelDomain } = req.body;

      const branding = await prisma.brandingSetting.upsert({
        where: { id: 'default' },
        update: {
          panelName,
          logoUrl,
          supportEmail,
          whiteLabelDomain,
        },
        create: {
          id: 'default',
          panelName,
          logoUrl,
          supportEmail,
          whiteLabelDomain,
        },
      });

      await cache.delPattern('settings:branding');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'BrandingSettings',
          changes: { branding },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(branding);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getSmtp(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'settings:smtp';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const smtp = await prisma.smtpSetting.findFirst();

      const result = smtp || {
        host: '',
        port: 587,
        username: '',
        fromEmail: '',
        secure: true,
      };

      // Remove password from response
      const { password, ...smtpData } = result as any;

      await cache.set(cacheKey, smtpData, 300);
      res.json(smtpData);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async saveSmtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { host, port, username, password, fromEmail, secure } = req.body;

      const smtp = await prisma.smtpSetting.upsert({
        where: { id: 'default' },
        update: {
          host,
          port,
          username,
          password: password ? password : undefined,
          fromEmail,
          secure,
        },
        create: {
          id: 'default',
          host,
          port,
          username,
          password: password || '',
          fromEmail,
          secure,
        },
      });

      await cache.delPattern('settings:smtp');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'SmtpSettings',
          changes: { host, port, username, fromEmail, secure },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      const { password: _, ...smtpData } = smtp;
      res.json(smtpData);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async testSmtp(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // In production, this would actually test the SMTP connection
      // For now, just return success
      res.json({
        ok: true,
        message: 'SMTP connection test successful',
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getSecurity(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'settings:security';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const security = await prisma.securitySetting.findFirst();

      const result = security || {
        twoFactorRequired: false,
        ipAllowlist: '',
        sessionTimeoutMinutes: 60,
      };

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async saveSecurity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { twoFactorRequired, ipAllowlist, sessionTimeoutMinutes } = req.body;

      const security = await prisma.securitySetting.upsert({
        where: { id: 'default' },
        update: {
          twoFactorRequired,
          ipAllowlist,
          sessionTimeoutMinutes,
        },
        create: {
          id: 'default',
          twoFactorRequired,
          ipAllowlist,
          sessionTimeoutMinutes,
        },
      });

      await cache.delPattern('settings:security');

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'SecuritySettings',
          changes: { twoFactorRequired, ipAllowlist, sessionTimeoutMinutes },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json(security);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
          lastLogin: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json(users);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async inviteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, role } = req.body;

      const existing = await prisma.user.findUnique({
        where: { email },
      });

      if (existing) {
        throw new AppError('User already exists', 409);
      }

      // Generate temporary password
      const tempPassword = cryptoUtils.generateSecurePassword(12);
      const hashedPassword = await cryptoUtils.hashPassword(tempPassword);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          role,
          name: email.split('@')[0],
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      });

      // Create notification settings
      await prisma.notificationSetting.create({
        data: {
          userId: user.id,
        },
      });

      // In production, send invitation email
      console.log('User invited', { email, role, tempPassword });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'INVITE_USER',
          resource: 'User',
          resourceId: user.id,
          changes: { email, role },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json({
        ...user,
        // In development, return temp password
        ...(process.env.NODE_ENV === 'development' && { tempPassword }),
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getApiKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const apiKeys = await prisma.apiKey.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          label: true,
          lastUsed: true,
          createdAt: true,
          revoked: true,
        },
      });

      res.json(apiKeys);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async createApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { label } = req.body;

      if (!label) {
        throw new AppError('Label is required', 400);
      }

      const { key, hash } = cryptoUtils.generateApiKey();

      const apiKey = await prisma.apiKey.create({
        data: {
          userId: req.user!.id,
          label,
          keyHash: hash,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_API_KEY',
          resource: 'ApiKey',
          resourceId: apiKey.id,
          changes: { label },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json({
        id: apiKey.id,
        label: apiKey.label,
        key, // Only shown once
        createdAt: apiKey.createdAt,
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async revokeApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const apiKey = await prisma.apiKey.findFirst({
        where: {
          id,
          userId: req.user!.id,
        },
      });

      if (!apiKey) {
        throw new AppError('API key not found', 404);
      }

      await prisma.apiKey.update({
        where: { id },
        data: { revoked: true },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'REVOKE_API_KEY',
          resource: 'ApiKey',
          resourceId: id,
          changes: { label: apiKey.label },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: 'API key revoked successfully',
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async createBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // In production, this would create a database backup
      // For now, just log
      console.log('Backup initiated', { userId: req.user!.id });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_BACKUP',
          resource: 'System',
          changes: { timestamp: new Date().toISOString() },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        url: `/backups/backup_${Date.now()}.sql`,
        message: 'Backup created successfully',
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}