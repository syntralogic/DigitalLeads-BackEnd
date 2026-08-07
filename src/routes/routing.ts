import { Router } from 'express';
import { RoutingController } from '../controllers/routingController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const routingRuleSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    type: z.enum(['COUNTRY', 'DEVICE', 'BROWSER', 'OS', 'WEIGHT']),
    conditions: z.record(z.any()),
    weight: z.number().int().min(0).max(100).default(100),
    targetOfferId: z.string().uuid().optional(),
    backupOfferId: z.string().uuid().optional(),
    priority: z.number().int().default(0),
    enabled: z.boolean().default(true),
  }),
});

router.use(authenticate);

router.get('/', RoutingController.list);
router.post('/', authorize('ADMIN', 'MANAGER'), validate(routingRuleSchema), RoutingController.create);
router.patch('/:id', authorize('ADMIN', 'MANAGER'), validate(routingRuleSchema.partial()), RoutingController.update);
router.delete('/:id', authorize('ADMIN'), RoutingController.delete);
router.post('/reorder', authorize('ADMIN', 'MANAGER'), RoutingController.reorder);

export default router;