import { Router } from 'express';
import { PostbackController } from '../controllers/postbackController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const postbackConfigSchema = z.object({
  body: z.object({
    url: z.string().url('Invalid URL'),
    method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
    retries: z.number().int().min(0).max(5).default(3),
  }),
});

router.use(authenticate);

router.get('/config/:scope', PostbackController.getConfig);
router.put('/config/:scope', authorize('ADMIN', 'MANAGER'), validate(postbackConfigSchema), PostbackController.saveConfig);
router.get('/logs', PostbackController.getLogs);
router.post('/logs/:id/retry', authorize('ADMIN', 'MANAGER'), PostbackController.retry);
router.post('/test', validate(z.object({ body: z.object({ url: z.string().url() }) })), PostbackController.test);

export default router;