import { Router } from 'express';
import { z } from 'zod';
import { registerUser, loginUser, adminLogin } from '../services/auth.service';
import { authRateLimiter, adminIpWhitelist } from '../middleware/rateLimiter';
import { authenticate } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  phone: z.string().regex(/^\+251\d{9}$/, 'Phone must start with +251 followed by 9 digits'),
  fullName: z.string().min(2).max(100),
  birthdate: z.string().refine((date) => {
    const age = Math.floor((Date.now() - new Date(date).getTime()) / 31557600000);
    return age >= 18;
  }, 'Must be 18 years or older'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  password: z.string().min(1, 'Password is required'),
});

// ============================================
// PLAYER AUTH ENDPOINTS
// ============================================

/**
 * POST /api/auth/register
 * Register a new player account
 */
router.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const { phone, fullName, birthdate, password } = registerSchema.parse(req.body);
    const deviceId = req.headers['x-device-id'] as string || 'unknown';

    const result = await registerUser({ phone, fullName, birthdate, password, deviceId });

    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    next(error);
  }
});

/**
 * POST /api/auth/login
 * Login as player
 */
router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const { phone, password } = loginSchema.parse(req.body);
    const deviceId = req.headers['x-device-id'] as string || 'unknown';

    const result = await loginUser({ phone, password, deviceId });

    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user profile
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { wallet: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      wallet: user.wallet,
      lastLoginAt: user.lastLoginAt,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN AUTH ENDPOINTS
// ============================================

/**
 * POST /api/auth/admin/login
 * Admin login with IP whitelist
 */
router.post('/admin/login', adminIpWhitelist, authRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const deviceId = req.headers['x-device-id'] as string || 'unknown';

    const result = await adminLogin({ username, password, deviceId });

    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    next(error);
  }
});

export default router;
