import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: UserRole;
      userPhone?: string;
    }
  }
}

interface JwtPayload {
  userId: string;
  role: UserRole;
  phone: string;
  deviceId: string;
}

/**
 * Verify JWT token for regular players
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_ACCESS_SECRET;

    if (!secret) {
      console.error('❌ JWT_ACCESS_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, secret) as JwtPayload;

    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.userPhone = decoded.phone;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token. Please login again.' });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Verify JWT token for admin routes
 */
export const authenticateAdmin = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_ADMIN_SECRET;

    if (!secret) {
      console.error('❌ JWT_ADMIN_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, secret) as JwtPayload;

    // Enforce admin role
    if (decoded.role !== 'ADMIN' && decoded.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.userPhone = decoded.phone;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Admin token expired. Please login again.' });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid admin token. Please login again.' });
    }
    return res.status(500).json({ error: 'Admin authentication failed' });
  }
};

/**
 * Generate JWT tokens
 */
export const generateTokens = (userId: string, role: UserRole, phone: string, deviceId: string) => {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const adminSecret = process.env.JWT_ADMIN_SECRET;
  const accessExpiry = process.env.JWT_ACCESS_EXPIRY || '1h';
  const adminExpiry = process.env.JWT_ADMIN_EXPIRY || '1h';

  if (!accessSecret || !adminSecret) {
    throw new Error('JWT secrets not configured');
  }

  const payload = { userId, role, phone, deviceId };

  const accessToken = jwt.sign(payload, accessSecret, {
    expiresIn: accessExpiry,
  });

  const adminAccessToken = role !== 'PLAYER'
    ? jwt.sign(payload, adminSecret, { expiresIn: adminExpiry })
    : undefined;

  return {
    accessToken,
    adminAccessToken,
    expiresIn: accessExpiry,
  };
};
