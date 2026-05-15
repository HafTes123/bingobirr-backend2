import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware';
import { createTransaction } from '../services/transaction.service';
import { PaymentMethod, TransactionType } from '@prisma/client';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Validation schema
const transactionSchema = z.object({
  transactionId: z.string().min(3).max(64),
  amount: z.number().min(10, 'Minimum amount is 10 ETB'),
  paymentMethod: z.enum([PaymentMethod.TELEBIRR, PaymentMethod.CBE, PaymentMethod.AWASH_BANK, PaymentMethod.BOA]),
  type: z.enum([TransactionType.DEPOSIT, TransactionType.WITHDRAWAL]),
  receiptImagePath: z.string().optional(),
  note: z.string().optional(),
});

/**
 * POST /api/transactions
 * Create a new deposit or withdrawal request
 */
router.post('/', async (req, res, next) => {
  try {
    const { transactionId, amount, paymentMethod, type, receiptImagePath, note } = transactionSchema.parse(req.body);

    const transaction = await createTransaction({
      userId: req.userId!,
      transactionId,
      amount,
      paymentMethod,
      type,
      receiptImagePath,
      note,
      ipAddress: req.ip,
    });

    res.status(201).json(transaction);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    next(error);
  }
});

export default router;
