import bcrypt from 'bcrypt';
import { UserRole, User } from '@prisma/client';
import { generateTokens } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 12);
};

export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

interface RegisterInput {
  phone: string;
  fullName: string;
  birthdate: string;
  password: string;
  deviceId: string;
}

export const registerUser = async (input: RegisterInput) => {
  const { phone, fullName, birthdate, password, deviceId } = input;

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({ where: { phone } });
  if (existingUser) {
    throw { statusCode: 409, message: 'Phone number already registered' };
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user with wallet
  const user = await prisma.user.create({
    data: {
      phone,
      fullName,
      birthdate: new Date(birthdate),
      passwordHash,
      role: UserRole.PLAYER,
      currentDeviceId: deviceId,
      lastLoginAt: new Date(),
      wallet: {
        create: {
          balanceBirr: 0,
          bunaPoints: 0,
        },
      },
    },
    include: { wallet: true },
  });

  // Generate tokens
  const tokens = generateTokens(user.id, user.role, user.phone, deviceId);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      wallet: user.wallet,
    },
    tokens,
  };
};

interface LoginInput {
  phone: string;
  password: string;
  deviceId: string;
}

export const loginUser = async (input: LoginInput) => {
  const { phone, password, deviceId } = input;

  const user = await prisma.user.findUnique({
    where: { phone },
    include: { wallet: true },
  });

  if (!user) {
    throw { statusCode: 401, message: 'Invalid phone number or password' };
  }

  if (user.status === 'SUSPENDED' || user.status === 'BANNED') {
    throw { statusCode: 403, message: 'Your account has been suspended' };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw { statusCode: 429, message: 'Account locked. Try again later' };
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    // Increment login attempts
    const newAttempts = user.loginAttempts + 1;
    if (newAttempts >= 5) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: newAttempts,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000), // Lock for 15 minutes
        },
      });
      throw { statusCode: 429, message: 'Too many failed attempts. Locked for 15 minutes.' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: newAttempts },
    });

    throw { statusCode: 401, message: 'Invalid phone number or password' };
  }

  // Single device enforcement: invalidate previous session
  if (user.currentDeviceId && user.currentDeviceId !== deviceId) {
    console.log(`🔄 Single device enforcement: Invalidating old session for ${user.phone}`);
  }

  // Update user session
  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginAttempts: 0,
      lockedUntil: null,
      currentDeviceId: deviceId,
      lastLoginAt: new Date(),
    },
  });

  // Generate tokens
  const tokens = generateTokens(user.id, user.role, user.phone, deviceId);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      wallet: user.wallet,
    },
    tokens,
  };
};

interface AdminLoginInput {
  username: string;
  password: string;
  deviceId: string;
}

export const adminLogin = async (input: AdminLoginInput) => {
  const { username, password, deviceId } = input;

  const admin = await prisma.user.findFirst({
    where: {
      phone: username, // Admins use username stored in phone field
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
    },
    include: { wallet: true },
  });

  if (!admin) {
    throw { statusCode: 401, message: 'Invalid admin credentials' };
  }

  const isValid = await verifyPassword(password, admin.passwordHash);

  if (!isValid) {
    throw { statusCode: 401, message: 'Invalid admin credentials' };
  }

  // Update session
  await prisma.user.update({
    where: { id: admin.id },
    data: {
      loginAttempts: 0,
      lockedUntil: null,
      currentDeviceId: deviceId,
      lastLoginAt: new Date(),
    },
  });

  // Admin tokens
  const tokens = generateTokens(admin.id, admin.role, admin.phone, deviceId);

  return {
    user: {
      id: admin.id,
      phone: admin.phone,
      fullName: admin.fullName,
      role: admin.role,
    },
    tokens: {
      accessToken: tokens.adminAccessToken || tokens.accessToken,
      expiresIn: tokens.expiresIn,
    },
  };
};
