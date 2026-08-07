import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@digitalleads.com' },
    update: {},
    create: {
      email: 'admin@digitalleads.com',
      password: adminPassword,
      name: 'Admin User',
      role: UserRole.ADMIN,
    },
  });
  console.log(`✅ Created admin user: ${admin.email}`);

  // Create manager user
  const managerPassword = await bcrypt.hash('Manager@123', 10);
  const manager = await prisma.user.upsert({
    where: { email: 'manager@digitalleads.com' },
    update: {},
    create: {
      email: 'manager@digitalleads.com',
      password: managerPassword,
      name: 'Manager User',
      role: UserRole.MANAGER,
    },
  });
  console.log(`✅ Created manager user: ${manager.email}`);

  // Create default branding settings
  await prisma.brandingSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      panelName: 'DigitalLeads',
      supportEmail: 'support@digitalleads.com',
    },
  });
  console.log('✅ Created branding settings');

  // Create default security settings
  await prisma.securitySetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      twoFactorRequired: false,
      sessionTimeoutMinutes: 60,
    },
  });
  console.log('✅ Created security settings');

  console.log('🌱 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });