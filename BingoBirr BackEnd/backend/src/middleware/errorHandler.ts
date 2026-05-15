import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  // Prisma unique constraint violation (duplicate transaction ID)
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A record with this unique value already exists.',
      field: err.meta?.target?.[0],
    });
  }

  // Prisma not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Not found',
      message: 'Record not found.',
    });
  }

  // Default
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
