import { Router } from 'express';
import { AnalyticsController } from '../controllers/analyticsController';
import { authenticate } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

const reportSchema = z.object({
  query: z.object({
    dimension: z.enum(['offer', 'network', 'country', 'device', 'browser', 'os', 'source']),
    granularity: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'custom']),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    search: z.string().optional(),
  }),
});

router.use(authenticate);

// Report routes
router.get('/report', validate(reportSchema), cacheMiddleware({ ttl: 60 }), AnalyticsController.getReport);
router.get('/series', validate(reportSchema), cacheMiddleware({ ttl: 60 }), AnalyticsController.getSeries);

// Export route - ADD THIS
router.get('/export', AnalyticsController.export);

// Geo and Devices routes
router.get('/geo/:level', cacheMiddleware({ ttl: 300 }), AnalyticsController.getGeo);
router.get('/devices', cacheMiddleware({ ttl: 300 }), AnalyticsController.getDevices);

export default router;