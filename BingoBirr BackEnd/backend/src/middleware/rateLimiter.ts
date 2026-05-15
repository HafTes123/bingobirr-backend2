import { Request, Response, NextFunction } from 'express';
import { Request as ExRequest } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter
 */
export const globalRateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limiter for authentication endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Admin IP whitelist middleware
 */
export const adminIpWhitelist = (req: ExRequest, res: Response, next: NextFunction) => {
  const whitelist = process.env.ADMIN_IP_WHITELIST;
  
  // If no whitelist is configured, allow all (not recommended for production)
  if (!whitelist) {
    console.warn('⚠️ ADMIN_IP_WHITELIST not configured. All IPs allowed.');
    return next();
  }

  const clientIp = req.ip || req.socket.remoteAddress;
  if (!clientIp) {
    return res.status(403).json({ error: 'Unable to determine IP address' });
  }

  const allowedIps = whitelist.split(',').map(ip => ip.trim());
  
  // Check if IP is in whitelist
  if (!allowedIps.includes(clientIp)) {
    console.warn(`🚨 Unauthorized admin access attempt from IP: ${clientIp}`);
    return res.status(403).json({ 
      error: 'Access denied. Your IP is not whitelisted for admin access.',
      yourIp: clientIp 
    });
  }

  next();
};
