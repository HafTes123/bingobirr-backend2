import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/users/profile
 * Get user profile with wallet
 */
router.get('/profile', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { wallet: true },
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/wallet
 * Get wallet balance
 */
router.get('/wallet', async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.userId },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    res.json(wallet);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/transactions
 * Get user's transaction history
 */
router.get('/transactions', async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

export default router;
