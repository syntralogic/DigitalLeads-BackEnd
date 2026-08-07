import { Router } from 'express';
import { OfferController } from '../controllers/offerController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const offerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    category: z.string().optional(),
    country: z.string().optional(),
    deviceTargeting: z.string().optional(),
    browserTargeting: z.string().optional(),
    payout: z.number().positive().optional(),
    dailyCap: z.number().int().positive().optional(),
    hourlyCap: z.number().int().positive().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    networkId: z.string().uuid('Invalid network ID'),
    status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED', 'EXPIRED']).optional(),
  }),
});

const updateOfferSchema = z.object({
  body: offerSchema.shape.body.partial(),
});

const bulkImportSchema = z.object({
  body: z.object({
    rows: z.array(z.object({
      name: z.string(),
      category: z.string().optional(),
      country: z.string().optional(),
      deviceTargeting: z.string().optional(),
      browserTargeting: z.string().optional(),
      payout: z.number().optional(),
      dailyCap: z.number().optional(),
      hourlyCap: z.number().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      networkId: z.string().uuid(),
    })),
  }),
});

router.use(authenticate);

router.get('/', OfferController.list);
router.get('/:id', OfferController.getById);
router.post('/', authorize('ADMIN', 'MANAGER'), validate(offerSchema), OfferController.create);
router.patch('/:id', authorize('ADMIN', 'MANAGER'), validate(updateOfferSchema), OfferController.update);
router.delete('/:id', authorize('ADMIN'), OfferController.delete);
router.post('/:id/clone', authorize('ADMIN', 'MANAGER'), OfferController.clone);
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), OfferController.setStatus);
router.post('/bulk', authorize('ADMIN'), validate(bulkImportSchema), OfferController.bulkImport);
router.get('/:id/preview', OfferController.getPreview);

export default router;