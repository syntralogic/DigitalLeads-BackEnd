import { Router } from 'express';
import { ClickController } from '../controllers/clickController';
import { authenticate } from '../middleware/auth';

const router = Router();

// PUBLIC - Track click (no auth needed)
router.post('/', ClickController.track);

// PROTECTED - List, export, and get single click
router.get('/', authenticate, ClickController.list);
router.get('/export', authenticate, ClickController.export);
router.get('/:id', authenticate, ClickController.getById);

export default router;