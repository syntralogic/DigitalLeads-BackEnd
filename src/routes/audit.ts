import { Router } from 'express';
import { AuditController } from '../controllers/auditController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const auditLogSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    page: z.string().optional().transform(Number).pipe(z.number().int().positive().default(1)),
    pageSize: z.string().optional().transform(Number).pipe(z.number().int().min(1).max(100).default(25)),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    action: z.string().optional(),
    resource: z.string().optional(),
  }),
});

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));

router.get('/', validate(auditLogSchema), AuditController.getLogs);
router.get('/export', AuditController.export);

export default router;