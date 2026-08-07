import { Router } from 'express';
import { AIController } from '../controllers/aiController';
import { authenticate } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

router.use(authenticate);

router.get('/scores', cacheMiddleware({ ttl: 60 }), AIController.getScores);
router.get('/offers/:type', cacheMiddleware({ ttl: 300 }), AIController.getOffers);
router.get('/forecast/:metric', cacheMiddleware({ ttl: 300 }), AIController.getForecast);
router.get('/recommendations', cacheMiddleware({ ttl: 300 }), AIController.getRecommendations);
router.get('/heatmap', cacheMiddleware({ ttl: 300 }), AIController.getHeatmap);
router.post('/optimize', AIController.runOptimization);

export default router;