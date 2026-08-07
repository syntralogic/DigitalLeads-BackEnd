import { Router } from 'express';
import { DeviceController } from '../controllers/deviceController';
import { authenticate } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

router.use(authenticate);

router.get('/', cacheMiddleware({ ttl: 300 }), DeviceController.getDevices);

export default router;