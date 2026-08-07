import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema } from '../middleware/validation';

const router = Router();

router.post('/login', validate(loginSchema), AuthController.login);
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);
router.get('/me', authenticate, AuthController.getMe);
router.patch('/profile', authenticate, validate(updateProfileSchema), AuthController.updateProfile);
router.post('/logout', authenticate, AuthController.logout);
router.post('/refresh', AuthController.refreshToken);

export default router;