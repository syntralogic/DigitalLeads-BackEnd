import { prisma } from '../config/database';
import { jwtUtils } from '../config/jwt';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';

export class AuthService {
  static async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = jwtUtils.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const { password: _, ...userData } = user;
    return { user: userData, token };
  }

  static async register(email: string, password: string, name: string, role?: UserRole) {
    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: role || UserRole.VIEWER,
      },
    });

    // Create notification settings
    await prisma.notificationSetting.create({
      data: {
        userId: user.id,
      },
    });

    const { password: _, ...userData } = user;
    return userData;
  }

  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        notificationSettings: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const { password: _, ...userData } = user;
    return userData;
  }

  static async updateProfile(userId: string, data: { name?: string; email?: string; avatar?: string }) {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    const { password: _, ...userData } = user;
    return userData;
  }

  static async logout(token: string, userId: string) {
    // Blacklist token
    const decoded = jwtUtils.decode(token);
    if (decoded) {
      const ttl = await cache.ttl(token);
      if (ttl > 0) {
        await cache.set(`blacklist:${token}`, true, ttl);
      }
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        resource: 'User',
        resourceId: userId,
      },
    });
  }

  static async refreshToken(refreshToken: string) {
    const decoded = jwtUtils.verify(refreshToken);
    const newToken = jwtUtils.sign({
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    });

    return newToken;
  }
}