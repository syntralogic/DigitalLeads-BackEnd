import { Router } from 'express';
import { ConversionController } from '../controllers/conversionController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const conversionListSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'HOLD', 'CHARGEBACK']).optional(),
    offer: z.string().uuid().optional(),
    network: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.string().optional().transform(Number).pipe(z.number().int().positive().default(1)),
    pageSize: z.string().optional().transform(Number).pipe(z.number().int().min(1).max(100).default(25)),
  }),
});

router.use(authenticate);

router.get('/', validate(conversionListSchema), ConversionController.list);
router.get('/export', ConversionController.export);
router.get('/timeline', ConversionController.getTimeline);
router.get('/:id', ConversionController.getById);
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), ConversionController.setStatus);
router.post('/', ConversionController.create);

export default router;