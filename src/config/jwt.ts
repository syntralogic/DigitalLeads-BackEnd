import jwt from 'jsonwebtoken';
import { logger } from './logger';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export const jwtUtils = {
  sign(payload: JwtPayload): string {
    try {
      return jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRY,
        issuer: 'digitalleads',
        audience: 'digitalleads-api',
      } as jwt.SignOptions);
    } catch (error) {
      logger.error('JWT sign error:', error);
      throw new Error('Failed to generate token');
    }
  },

  verify(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: 'digitalleads',
        audience: 'digitalleads-api',
      }) as JwtPayload;
      return decoded;
    } catch (error) {
      logger.error('JWT verify error:', error);
      throw new Error('Invalid or expired token');
    }
  },

  decode(token: string): JwtPayload | null {
    try {
      const decoded = jwt.decode(token) as JwtPayload;
      return decoded || null;
    } catch (error) {
      logger.error('JWT decode error:', error);
      return null;
    }
  },

  refresh(token: string): string {
    const decoded = this.verify(token);
    const { exp, iat, ...payload } = decoded as any;
    return this.sign(payload);
  },
};