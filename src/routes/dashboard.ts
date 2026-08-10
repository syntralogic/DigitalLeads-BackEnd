// src/routes/dashboardRoutes.ts
import { Router } from 'express';
import { DashboardController } from '../controllers/dashboardController';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

// ✅ Authentication is already applied in app.ts, so we don't need it here
// The route is mounted as: app.use('/api/dashboard', authenticate, dashboardRoutes);

router.get('/kpis', cacheMiddleware({ ttl: 30 }), DashboardController.getKpis);
router.get('/series/:metric', cacheMiddleware({ ttl: 60 }), DashboardController.getSeries);
router.get('/breakdown/:dimension', cacheMiddleware({ ttl: 60 }), DashboardController.getBreakdown);
router.get('/live', DashboardController.getLiveActivity);
router.get('/ai-recommendations', cacheMiddleware({ ttl: 300 }), DashboardController.getAIRecommendations);

export default router;