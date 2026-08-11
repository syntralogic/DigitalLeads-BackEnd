import { Router } from 'express';
import { NetworkController } from '../controllers/networkController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Validation schemas
const createNetworkSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    apiUrl: z.string().url().optional().nullable(),
    apiKey: z.string().optional().nullable(),
    postbackUrl: z.string().url().optional().nullable(),
    clickIdMapping: z.string().optional().nullable(),
    payoutMapping: z.string().optional().nullable(),
    statusMapping: z.string().optional().nullable(),
  }),
});

const updateNetworkSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    apiUrl: z.string().url().optional().nullable(),
    apiKey: z.string().optional().nullable(),
    postbackUrl: z.string().url().optional().nullable(),
    clickIdMapping: z.string().optional().nullable(),
    payoutMapping: z.string().optional().nullable(),
    statusMapping: z.string().optional().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  }),
});

const bulkImportSchema = z.object({
  body: z.object({
    rows: z.array(z.object({
      name: z.string(),
      apiUrl: z.string().optional(),
      apiKey: z.string().optional(),
      postbackUrl: z.string().optional(),
      clickIdMapping: z.string().optional(),
      payoutMapping: z.string().optional(),
      statusMapping: z.string().optional(),
    })),
  }),
});

// All routes require authentication
router.use(authenticate);

router.get('/', NetworkController.list);
router.get('/:id', NetworkController.getById);
router.post('/', authorize('ADMIN', 'MANAGER'), validate(createNetworkSchema), NetworkController.create);
router.patch('/:id', authorize('ADMIN', 'MANAGER'), validate(updateNetworkSchema), NetworkController.update);
router.delete('/:id', authorize('ADMIN'), NetworkController.delete);
router.patch('/:id/status', authorize('ADMIN', 'MANAGER'), NetworkController.setStatus);
router.post('/:id/test-connection', authorize('ADMIN', 'MANAGER'), NetworkController.testConnection);
router.post('/:id/test-postback', authorize('ADMIN', 'MANAGER'), NetworkController.testPostback);
router.post('/bulk', authorize('ADMIN'), validate(bulkImportSchema), NetworkController.bulkImport);

export default router;