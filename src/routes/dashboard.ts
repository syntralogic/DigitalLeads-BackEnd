import { Router } from 'express';
import { DashboardController } from '../controllers/dashboardController';
import { authenticate } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

router.use(authenticate);

router.get('/kpis', cacheMiddleware({ ttl: 30 }), DashboardController.getKpis);
router.get('/series/:metric', cacheMiddleware({ ttl: 60 }), DashboardController.getSeries);
router.get('/breakdown/:dimension', cacheMiddleware({ ttl: 60 }), DashboardController.getBreakdown);
router.get('/live', DashboardController.getLiveActivity);
router.get('/ai-recommendations', cacheMiddleware({ ttl: 300 }), DashboardController.getAIRecommendations);

export default router;