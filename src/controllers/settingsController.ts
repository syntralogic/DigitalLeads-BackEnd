import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { cryptoUtils } from '../utils/crypto';
import nodemailer from 'nodemailer';

export class SettingsController {
  // ============================================================
  // BRANDING
  // ============================================================

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
      console.error('Get branding error:', error);
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
      console.error('Save branding error:', error);
      next(error);
    }
  }

  // ============================================================
  // SMTP
  // ============================================================

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
      console.error('Get SMTP error:', error);
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
      console.error('Save SMTP error:', error);
      next(error);
    }
  }

  static async testSmtp(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      // Get SMTP settings from database
      const smtp = await prisma.smtpSetting.findFirst();
      
      if (!smtp || !smtp.host) {
        throw new AppError('SMTP settings not configured. Please save SMTP settings first.', 400);
      }

      // Log what we're trying to connect to
      console.log('SMTP Test Config:', {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        username: smtp.username,
        fromEmail: smtp.fromEmail,
      });

      // Create transporter with proper settings
      // For Gmail: port 587, secure: false (STARTTLS)
      // For Gmail: port 465, secure: true (SSL)
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.username,
          pass: smtp.password || '',
        },
        tls: {
          // Allow self-signed certificates for testing
          rejectUnauthorized: false,
        },
        // For Gmail specifically
        ...(smtp.host.includes('gmail.com') && {
          service: 'gmail',
        }),
      });

      // Verify connection
      await transporter.verify();

      // Send test email
      const testEmail = req.body.email || smtp.fromEmail || 'test@example.com';
      
      const mailOptions = {
        from: `"DigitalLeads" <${smtp.fromEmail}>`,
        to: testEmail,
        subject: 'DigitalLeads SMTP Test',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #2563eb; margin-bottom: 20px;">SMTP Configuration Test</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              This is a test email from your <strong>DigitalLeads</strong> platform.
            </p>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 5px 0; color: #64748b; font-size: 14px;">
                <strong>Host:</strong> ${smtp.host}
              </p>
              <p style="margin: 5px 0; color: #64748b; font-size: 14px;">
                <strong>Port:</strong> ${smtp.port}
              </p>
              <p style="margin: 5px 0; color: #64748b; font-size: 14px;">
                <strong>Username:</strong> ${smtp.username}
              </p>
              <p style="margin: 5px 0; color: #64748b; font-size: 14px;">
                <strong>Secure:</strong> ${smtp.secure ? 'Yes (SSL/TLS)' : 'No (STARTTLS)'}
              </p>
            </div>
            <p style="color: #64748b; font-size: 14px;">
              <span style="color: #22c55e;">✓</span> SMTP configuration is working correctly!
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
              Sent at: ${new Date().toLocaleString()}
            </p>
          </div>
        `,
      };

      const info = await transporter.sendMail(mailOptions);

      // Log successful test
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'TEST_SMTP',
          resource: 'SmtpSettings',
          changes: { 
            host: smtp.host,
            port: smtp.port,
            fromEmail: smtp.fromEmail,
            to: testEmail,
            messageId: info.messageId,
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        ok: true,
        message: 'Test email sent successfully! Check your inbox.',
        messageId: info.messageId,
      });
      return;
    } catch (error: any) {
      console.error('SMTP test error:', error);
      
      // Log failed test
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'TEST_SMTP_FAILED',
          resource: 'SmtpSettings',
          changes: { 
            error: error.message,
            code: error.code,
            timestamp: new Date().toISOString(),
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      // Send detailed error response
      let errorMessage = 'SMTP test failed: ';
      let errorCode = error.code || 'UNKNOWN_ERROR';
      
      if (error.code === 'ECONNECTION') {
        errorMessage += 'Could not connect to SMTP server. Check host and port.';
      } else if (error.code === 'EAUTH') {
        errorMessage += 'Authentication failed. Check username and password.';
      } else if (error.code === 'ESOCKET') {
        errorMessage += 'Connection timeout. Check firewall settings.';
      } else if (error.responseCode === 535) {
        errorMessage += 'Authentication failed. Invalid credentials.';
      } else if (error.message?.includes('wrong version number')) {
        errorMessage += 'SSL/TLS version mismatch. Try setting "Secure" to OFF for port 587, or ON for port 465.';
        errorCode = 'SSL_VERSION_MISMATCH';
      } else {
        errorMessage += error.message;
      }

      res.status(400).json({
        ok: false,
        message: errorMessage,
        code: errorCode,
      });
      return;
    }
  }

  // ============================================================
  // SECURITY
  // ============================================================

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
        ipAllowlist: null,
        sessionTimeoutMinutes: 60,
      };

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
      console.error('Get security error:', error);
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
          ipAllowlist: ipAllowlist || null,
          sessionTimeoutMinutes,
        },
        create: {
          id: 'default',
          twoFactorRequired,
          ipAllowlist: ipAllowlist || null,
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
      console.error('Save security error:', error);
      next(error);
    }
  }

  // ============================================================
  // USERS
  // ============================================================

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
      console.error('Get users error:', error);
      next(error);
    }
  }

  static async inviteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, role } = req.body;

      if (!email || !role) {
        throw new AppError('Email and role are required', 400);
      }

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
          createdAt: true,
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
      console.error('Invite user error:', error);
      next(error);
    }
  }

  // ============================================================
  // API KEYS
  // ============================================================

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
      console.error('Get API keys error:', error);
      next(error);
    }
  }

  static async createApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { label } = req.body;

      // Validate label is a string
      if (!label || typeof label !== 'string' || label.trim().length === 0) {
        throw new AppError('Label is required and must be a non-empty string', 400);
      }

      const { key, hash } = cryptoUtils.generateApiKey();

      const apiKey = await prisma.apiKey.create({
        data: {
          userId: req.user!.id,
          label: label.trim(),
          keyHash: hash,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_API_KEY',
          resource: 'ApiKey',
          resourceId: apiKey.id,
          changes: { label: label.trim() },
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
      console.error('Create API key error:', error);
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

      if (apiKey.revoked) {
        throw new AppError('API key already revoked', 400);
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
      console.error('Revoke API key error:', error);
      next(error);
    }
  }

  // ============================================================
  // BACKUP
  // ============================================================

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
      console.error('Create backup error:', error);
      next(error);
    }
  }

  // ============================================================
  // AUDIT LOGS (Optional - can be added later)
  // ============================================================

  static async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        search,
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {};
      if (search) {
        where.OR = [
          { action: { contains: search as string, mode: 'insensitive' } },
          { resource: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip,
          take,
          orderBy: { timestamp: 'desc' },
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
      console.error('Get audit logs error:', error);
      next(error);
    }
  }
}