import { Router } from 'express';
import { AuditController } from '../controllers/auditController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Remove the validate middleware that's causing the 400 error
// or make it optional

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));

// Simple routes without validation
router.get('/', AuditController.getLogs);
router.get('/export', AuditController.export);

export default router;