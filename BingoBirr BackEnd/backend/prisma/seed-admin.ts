/**
 * Seed Admin Account
 * Usage: npm run seed:admin
 * 
 * This creates the first super admin account.
 * In production, run this ONLY once on initial deployment.
 */

import bcrypt from 'bcrypt';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding admin account...');

  const adminPhone = '+251911000001';
  const adminPassword = 'Admin@BingoBirr2026!'; // CHANGE THIS IMMEDIATELY
  const adminName = 'Bereket Tadesse';
  const birthdate = new Date('1990-01-01');

  // Check if admin already exists
  const existing = await prisma.user.findUnique({
    where: { phone: adminPhone },
  });

  if (existing) {
    console.log('⚠️  Admin account already exists. Skipping.');
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  // Create admin
  const admin = await prisma.user.create({
    data: {
      phone: adminPhone,
      fullName: adminName,
      birthdate,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
    },
  });

  console.log(`✅ Super Admin created: ${admin.phone}`);
  console.log(`🔑 Password: ${adminPassword}`);
  console.log('⚠️  CHANGE THE PASSWORD IMMEDIATELY!');

  // Seed default game patterns
  console.log('🌱 Seeding default game patterns...');

  const patterns = [
    {
      name: '⭐ Full House (Blackout)',
      grid: [[true, true, true, true, true], [true, true, true, true, true], [true, true, true, true, true], [true, true, true, true, true], [true, true, true, true, true]],
      gameMode: 'DAILY_MEGA_EVENT',
    },
    {
      name: '❌ Diagonal X-Shape',
      grid: [[true, false, false, false, true], [false, true, false, true, false], [false, false, true, false, false], [false, true, false, true, false], [true, false, false, false, true]],
      gameMode: 'FIXED_PRIZE',
    },
    {
      name: '🔲 Outer Frame',
      grid: [[true, true, true, true, true], [true, false, false, false, true], [true, false, false, false, true], [true, false, false, false, true], [true, true, true, true, true]],
      gameMode: 'POOL_BASED',
    },
    {
      name: '⚡ FastBingo Line',
      grid: [[false, false, false, false, false], [false, false, false, false, false], [true, true, true, true, true], [false, false, false, false, false], [false, false, false, false, false]],
      gameMode: 'FAST_BINGO',
    },
    {
      name: '☕ Buna Jackpot (Coffee Pot)',
      grid: [[false, true, true, true, false], [true, true, true, true, true], [true, true, true, true, false], [false, true, true, true, false], [false, false, true, false, false]],
      gameMode: 'BUNA_JACKPOT',
    },
  ];

  for (const pattern of patterns) {
    await prisma.gamePattern.create({
      data: {
        name: pattern.name,
        grid: pattern.grid as any,
        gameMode: pattern.gameMode as any,
        isActive: true,
      },
    });
    console.log(`✅ Pattern created: ${pattern.name}`);
  }

  // Seed default system settings
  console.log('🌱 Seeding default system settings...');

  const settings = [
    { key: 'PURCHASE_WINDOW_MINUTES', value: '2', description: 'Default purchase window in minutes' },
    { key: 'DRAW_INTERVAL_SECONDS', value: '4', description: 'Ball draw interval in seconds' },
    { key: 'HOUSE_COMMISSION_PCT', value: '15', description: 'House commission percentage for pool-based games' },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.create({
      data: setting,
    });
    console.log(`✅ Setting created: ${setting.key} = ${setting.value}`);
  }

  console.log('✅ Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
