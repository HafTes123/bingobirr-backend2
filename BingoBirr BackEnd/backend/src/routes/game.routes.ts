import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';

const router = Router();

/**
 * GET /api/game/patterns
 * Get all active game patterns (public)
 */
router.get('/patterns', async (req, res, next) => {
  try {
    const patterns = await prisma.gamePattern.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json(patterns);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/game/settings
 * Get current game settings (public)
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

// Authenticated game routes
router.use(authenticate);

/**
 * GET /api/game/current
 * Get current game session state
 */
router.get('/current', async (req, res, next) => {
  try {
    const session = await prisma.gameSession.findFirst({
      where: { status: { in: ['WAITING', 'PURCHASE_OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        cards: {
          where: { userId: req.userId },
        },
      },
    });

    res.json(session || { status: 'NO_ACTIVE_GAME' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/game/cards
 * Purchase a new bingo card
 */
router.post('/cards', async (req, res, next) => {
  try {
    const { sessionId, ticketPrice } = req.body;

    // Verify session is in purchase phase
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || !['WAITING', 'PURCHASE_OPEN'].includes(session.status)) {
      return res.status(400).json({ error: 'Card purchase is not available' });
    }

    // Check wallet balance
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });

    if (!wallet || wallet.balanceBirr.toNumber() < ticketPrice) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Generate 5x5 card matrix
    const matrix: number[][] = [];
    for (let row = 0; row < 5; row++) {
      const rowNumbers: number[] = [];
      for (let col = 0; col < 5; col++) {
        if (row === 2 && col === 2) {
          rowNumbers.push(0); // FREE space
        } else {
          const min = col * 15 + 1;
          let num: number;
          do {
            num = Math.floor(Math.random() * 15) + min;
          } while (rowNumbers.includes(num));
          rowNumbers.push(num);
        }
      }
      matrix.push(rowNumbers);
    }

    // Deduct from wallet and create card
    const card = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: req.userId },
        data: { balanceBirr: { decrement: ticketPrice } },
      });

      return tx.bingoCard.create({
        data: {
          userId: req.userId!,
          sessionId,
          matrix,
          marked: Array(5).fill(null).map((_, r) => 
            Array(5).fill(false).map((_, c) => r === 2 && c === 2)
          ),
          ticketPrice,
        },
      });
    });

    // Update player count
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { totalPlayers: { increment: 1 } },
    });

    res.status(201).json(card);
  } catch (error) {
    next(error);
  }
});

export default router;
