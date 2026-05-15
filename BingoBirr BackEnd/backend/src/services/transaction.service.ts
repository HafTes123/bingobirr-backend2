import { PaymentMethod, TransactionType, TxStatus } from '@prisma/client';
import prisma from '../lib/prisma';

interface CreateTransactionInput {
  userId: string;
  transactionId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  type: TransactionType;
  receiptImagePath?: string;
  note?: string;
  ipAddress?: string;
}

export const createTransaction = async (input: CreateTransactionInput) => {
  // Create transaction with UNIQUE constraint enforcement
  const transaction = await prisma.transaction.create({
    data: {
      userId: input.userId,
      transactionId: input.transactionId.toUpperCase(),
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      type: input.type,
      receiptImagePath: input.receiptImagePath,
      note: input.note,
      ipAddress: input.ipAddress,
      status: TxStatus.PENDING,
    },
  });

  // If withdrawal, immediately deduct from wallet
  if (input.type === TransactionType.WITHDRAWAL) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: input.userId } });
    
    if (!wallet || wallet.balanceBirr.toNumber() < input.amount) {
      throw { statusCode: 400, message: 'Insufficient balance' };
    }

    await prisma.wallet.update({
      where: { userId: input.userId },
      data: {
        balanceBirr: { decrement: input.amount },
        pendingWithdrawal: { increment: input.amount },
      },
    });
  }

  return transaction;
};

interface ApproveTransactionInput {
  transactionId: string;
  adminId: string;
}

export const approveTransaction = async ({ transactionId, adminId }: ApproveTransactionInput) => {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { transactionId: transactionId.toUpperCase() },
    });

    if (!transaction) {
      throw { statusCode: 404, message: 'Transaction not found' };
    }

    if (transaction.status !== 'PENDING') {
      throw { statusCode: 400, message: `Transaction is already ${transaction.status}` };
    }

    // Update transaction status
    const updated = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: TxStatus.APPROVED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    // Update wallet based on transaction type
    if (transaction.type === TransactionType.DEPOSIT) {
      await tx.wallet.update({
        where: { userId: transaction.userId },
        data: { balanceBirr: { increment: transaction.amount } },
      });
    } else if (transaction.type === TransactionType.WITHDRAWAL) {
      await tx.wallet.update({
        where: { userId: transaction.userId },
        data: {
          pendingWithdrawal: { decrement: transaction.amount },
        },
      });
    }

    // Create audit log
    await tx.auditLog.create({
      data: {
        adminId,
        userId: transaction.userId,
        action: `APPROVED_${transaction.type}`,
        entityType: 'Transaction',
        entityId: transaction.id,
        amount: transaction.amount,
        description: `${transaction.type} of ${transaction.amount} ETB via ${transaction.paymentMethod}`,
        ipAddress: transaction.ipAddress || '',
      },
    });

    return updated;
  });
};

interface RejectTransactionInput {
  transactionId: string;
  adminId: string;
  note?: string;
}

export const rejectTransaction = async ({ transactionId, adminId, note }: RejectTransactionInput) => {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { transactionId: transactionId.toUpperCase() },
    });

    if (!transaction) {
      throw { statusCode: 404, message: 'Transaction not found' };
    }

    if (transaction.status !== 'PENDING') {
      throw { statusCode: 400, message: `Transaction is already ${transaction.status}` };
    }

    // Update transaction status
    const updated = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: TxStatus.REJECTED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        note: note || transaction.note,
      },
    });

    // If withdrawal was rejected, refund to wallet
    if (transaction.type === TransactionType.WITHDRAWAL) {
      await tx.wallet.update({
        where: { userId: transaction.userId },
        data: {
          balanceBirr: { increment: transaction.amount },
          pendingWithdrawal: { decrement: transaction.amount },
        },
      });
    }

    // Create audit log
    await tx.auditLog.create({
      data: {
        adminId,
        userId: transaction.userId,
        action: `REJECTED_${transaction.type}`,
        entityType: 'Transaction',
        entityId: transaction.id,
        amount: transaction.amount,
        description: `Rejected ${transaction.type} of ${transaction.amount} ETB. Reason: ${note || 'No reason provided'}`,
        ipAddress: transaction.ipAddress || '',
      },
    });

    return updated;
  });
};

export const getUserTransactions = async (userId: string) => {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
};

export const getPendingTransactions = async () => {
  return prisma.transaction.findMany({
    where: { status: TxStatus.PENDING },
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: { phone: true, fullName: true },
      },
    },
  });
};

export const getTransactionStats = async () => {
  const [totalDeposits, totalWithdrawals, pendingDeposits, pendingWithdrawals] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: TransactionType.DEPOSIT, status: { in: ['APPROVED', 'COMPLETED'] } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: TransactionType.WITHDRAWAL, status: { in: ['APPROVED', 'COMPLETED'] } },
      _sum: { amount: true },
    }),
    prisma.transaction.count({ where: { type: TransactionType.DEPOSIT, status: 'PENDING' } }),
    prisma.transaction.count({ where: { type: TransactionType.WITHDRAWAL, status: 'PENDING' } }),
  ]);

  return {
    totalDeposits: totalDeposits._sum.amount?.toNumber() || 0,
    totalWithdrawals: totalWithdrawals._sum.amount?.toNumber() || 0,
    netBalance: (totalDeposits._sum.amount?.toNumber() || 0) - (totalWithdrawals._sum.amount?.toNumber() || 0),
    pendingDeposits,
    pendingWithdrawals,
  };
};
