import { Router } from 'express';
import { GeoController } from '../controllers/geoController';
import { authenticate } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

router.use(authenticate);

// Make sure all routes are registered
router.get('/countries', cacheMiddleware({ ttl: 300 }), GeoController.getCountries);
router.get('/states', cacheMiddleware({ ttl: 300 }), GeoController.getStates);
router.get('/cities', cacheMiddleware({ ttl: 300 }), GeoController.getCities);
router.get('/isp', cacheMiddleware({ ttl: 300 }), GeoController.getISP);
router.get('/languages', cacheMiddleware({ ttl: 300 }), GeoController.getLanguages);
router.get('/timezones', cacheMiddleware({ ttl: 300 }), GeoController.getTimezones);
router.get('/map', cacheMiddleware({ ttl: 300 }), GeoController.getMapData);

export default router;