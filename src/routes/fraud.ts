import { Router } from 'express';
import { FraudController } from '../controllers/fraudController';
import { authenticate, authorize } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

router.use(authenticate);

router.get('/signals', cacheMiddleware({ ttl: 30 }), FraudController.getSignals);
router.get('/score', cacheMiddleware({ ttl: 30 }), FraudController.getScore);
router.get('/timeline', cacheMiddleware({ ttl: 60 }), FraudController.getTimeline);
router.get('/invalid-clicks', cacheMiddleware({ ttl: 30 }), FraudController.getInvalidClicks);
router.post('/block-ip', authorize('ADMIN', 'MANAGER'), FraudController.blockIp);

export default router;