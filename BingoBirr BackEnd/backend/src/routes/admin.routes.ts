import { Router } from 'express';
import { z } from 'zod';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { adminIpWhitelist, authRateLimiter } from '../middleware/rateLimiter';
import { approveTransaction, rejectTransaction, getPendingTransactions, getTransactionStats, getUserTransactions, createTransaction as createTransactionService } from '../services/transaction.service';
import prisma from '../lib/prisma';
import { PaymentMethod, TransactionType } from '@prisma/client';

const router = Router();

// Apply admin authentication + IP whitelist to all admin routes
router.use(adminIpWhitelist);
router.use(authenticateAdmin);

// ============================================
// ADMIN: DEPOSIT/TRANSACTION MANAGEMENT
// ============================================

/**
 * GET /api/admin/transactions/pending
 * Get all pending deposits/withdrawals
 */
router.get('/transactions/pending', async (req, res, next) => {
  try {
    const transactions = await getPendingTransactions();
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/transactions/:transactionId/approve
 * Approve a pending deposit/withdrawal
 */
router.post('/transactions/:transactionId/approve', authRateLimiter, async (req, res, next) => {
  try {
    const result = await approveTransaction({
      transactionId: req.params.transactionId,
      adminId: req.userId!,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/transactions/:transactionId/reject
 * Reject a pending deposit/withdrawal
 */
router.post('/transactions/:transactionId/reject', authRateLimiter, async (req, res, next) => {
  try {
    const result = await rejectTransaction({
      transactionId: req.params.transactionId,
      adminId: req.userId!,
      note: req.body.note,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN: USER MANAGEMENT
// ============================================

/**
 * GET /api/admin/users
 * Get all players with search/filter
 */
router.get('/users', async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const where: any = { role: 'PLAYER' };

    if (search) {
      where.OR = [
        { phone: { contains: search as string } },
        { fullName: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { wallet: true },
        orderBy: { createdAt: 'desc' },
        skip: ((Number(page) - 1) * Number(limit)),
        take: Number(limit),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page, limit });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/admin/users/:userId/status
 * Suspend/activate a player
 */
router.patch('/users/:userId/status', async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: { status },
      include: { wallet: true },
    });

    // Log action
    await prisma.auditLog.create({
      data: {
        adminId: req.userId!,
        userId: req.params.userId,
        action: `CHANGED_USER_STATUS_TO_${status}`,
        entityType: 'User',
        entityId: req.params.userId,
        ipAddress: req.ip || '',
      },
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN: GAME MANAGEMENT
// ============================================

/**
 * POST /api/admin/game/start
 * Start a new game session
 */
router.post('/game/start', async (req, res, next) => {
  try {
    const { gameMode, patternId, prizePotBirr, purchaseWindowMinutes, drawIntervalSeconds } = req.body;

    // Validate pattern exists
    const pattern = await prisma.gamePattern.findUnique({
      where: { id: patternId },
    });

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    const purchaseWindowSecs = (purchaseWindowMinutes || 2) * 60;

    const session = await prisma.gameSession.create({
      data: {
        gameMode,
        patternId,
        status: 'PURCHASE_OPEN',
        prizePotBirr: prizePotBirr || 0,
        purchaseWindowSecs,
        drawIntervalSecs: drawIntervalSeconds || 4,
      },
    });

    // Log action
    await prisma.auditLog.create({
      data: {
        adminId: req.userId!,
        action: 'STARTED_GAME_SESSION',
        entityType: 'GameSession',
        entityId: session.id,
        description: `Started ${gameMode} game with pattern "${pattern.name}"`,
        ipAddress: req.ip || '',
      },
    });

    // Broadcast to WebSocket
    const io = req.app.get('io');
    io.to(`game:${session.id}`).emit('game:started', session);

    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/game/stop
 * Stop current game session
 */
router.post('/game/stop', async (req, res, next) => {
  try {
    const session = await prisma.gameSession.findFirst({
      where: { status: { in: ['WAITING', 'PURCHASE_OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (!session) {
      return res.status(404).json({ error: 'No active game session found' });
    }

    const updated = await prisma.gameSession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED', endedAt: new Date() },
    });

    // Log action
    await prisma.auditLog.create({
      data: {
        adminId: req.userId!,
        action: 'CANCELLED_GAME_SESSION',
        entityType: 'GameSession',
        entityId: session.id,
        ipAddress: req.ip || '',
      },
    });

    // Broadcast to WebSocket
    const io = req.app.get('io');
    io.to(`game:${session.id}`).emit('game:cancelled', updated);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN: PATTERN MANAGEMENT
// ============================================

/**
 * GET /api/admin/patterns
 * Get all game patterns
 */
router.get('/patterns', async (req, res, next) => {
  try {
    const patterns = await prisma.gamePattern.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(patterns);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/patterns
 * Create new game pattern
 */
router.post('/patterns', async (req, res, next) => {
  try {
    const pattern = await prisma.gamePattern.create({
      data: {
        name: req.body.name,
        grid: req.body.grid,
        gameMode: req.body.gameMode,
        createdBy: req.userId!,
      },
    });

    // Log action
    await prisma.auditLog.create({
      data: {
        adminId: req.userId!,
        action: 'CREATED_PATTERN',
        entityType: 'GamePattern',
        entityId: pattern.id,
        ipAddress: req.ip || '',
      },
    });

    res.status(201).json(pattern);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN: SETTINGS
// ============================================

/**
 * GET /api/admin/settings
 * Get all system settings
 */
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await prisma.systemSetting.findMany();
    const settingsMap = settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {} as Record<string, string>);
    res.json(settingsMap);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/settings
 * Update system settings
 */
router.post('/settings', async (req, res, next) => {
  try {
    const updates = req.body;
    const results = [];

    for (const [key, value] of Object.entries(updates)) {
      const setting = await prisma.systemSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
      results.push(setting);
    }

    // Log action
    await prisma.auditLog.create({
      data: {
        adminId: req.userId!,
        action: 'UPDATED_SYSTEM_SETTINGS',
        description: `Updated settings: ${Object.keys(updates).join(', ')}`,
        ipAddress: req.ip || '',
      },
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN: REPORTS
// ============================================

/**
 * GET /api/admin/reports/stats
 * Get transaction statistics
 */
router.get('/reports/stats', async (req, res, next) => {
  try {
    const stats = await getTransactionStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/audit-logs
 * Get audit trail
 */
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: ((Number(page) - 1) * Number(limit)),
        take: Number(limit),
      }),
      prisma.auditLog.count(),
    ]);

    res.json({ logs, total, page, limit });
  } catch (error) {
    next(error);
  }
});

export default router;
