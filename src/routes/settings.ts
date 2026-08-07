import { Router } from 'express';
import { SettingsController } from '../controllers/settingsController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const brandingSchema = z.object({
  body: z.object({
    panelName: z.string().optional(),
    logoUrl: z.string().url().optional().nullable(),
    supportEmail: z.string().email().optional().nullable(),
    whiteLabelDomain: z.string().optional().nullable(),
  }),
});

const smtpSchema = z.object({
  body: z.object({
    host: z.string().min(1, 'Host is required'),
    port: z.number().int().min(1).max(65535).default(587),
    username: z.string().min(1, 'Username is required'),
    password: z.string().optional(),
    fromEmail: z.string().email('Invalid email address'),
    secure: z.boolean().default(true),
  }),
});

const securitySchema = z.object({
  body: z.object({
    twoFactorRequired: z.boolean().default(false),
    ipAllowlist: z.string().optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).default(60),
  }),
});

router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/branding', SettingsController.getBranding);
router.put('/branding', validate(brandingSchema), SettingsController.saveBranding);
router.get('/smtp', SettingsController.getSmtp);
router.put('/smtp', validate(smtpSchema), SettingsController.saveSmtp);
router.post('/smtp/test', SettingsController.testSmtp);
router.get('/security', SettingsController.getSecurity);
router.put('/security', validate(securitySchema), SettingsController.saveSecurity);
router.get('/users', SettingsController.getUsers);
router.post('/users', SettingsController.inviteUser);
router.get('/api-keys', SettingsController.getApiKeys);
router.post('/api-keys', SettingsController.createApiKey);
router.delete('/api-keys/:id', SettingsController.revokeApiKey);
router.post('/backup', SettingsController.createBackup);

export default router;