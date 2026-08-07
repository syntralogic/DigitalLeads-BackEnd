import { Router } from 'express';
import { DomainController } from '../controllers/domainController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const domainSchema = z.object({
  body: z.object({
    domain: z.string().min(1, 'Domain is required'),
    type: z.enum(['TRACKING', 'REDIRECT']),
    status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING']).default('PENDING'),
  }),
});

router.use(authenticate);

router.get('/', DomainController.list);
router.post('/', authorize('ADMIN', 'MANAGER'), validate(domainSchema), DomainController.create);
router.patch('/:id', authorize('ADMIN', 'MANAGER'), validate(domainSchema.partial()), DomainController.update);
router.delete('/:id', authorize('ADMIN'), DomainController.delete);
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), DomainController.setStatus);
router.post('/:id/verify', authorize('ADMIN', 'MANAGER'), DomainController.verify);

export default router;