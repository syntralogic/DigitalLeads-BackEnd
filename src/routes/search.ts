import { Router } from 'express';
import { SearchController } from '../controllers/searchController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const searchSchema = z.object({
  query: z.object({
    q: z.string().min(1, 'Search query is required'),
  }),
});

router.use(authenticate);

router.get('/', validate(searchSchema), SearchController.global);

export default router;