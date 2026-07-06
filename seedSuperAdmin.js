require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const SUPER_ADMIN_EMAIL = 'superadmin@focus.com';
const SUPER_ADMIN_PASSWORD = 'Pass123';

const seedSuperAdmin = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(mongoUri);

  const existingUser = await User.findOne({
    $or: [
      { email: SUPER_ADMIN_EMAIL },
      { username: SUPER_ADMIN_EMAIL }
    ]
  });

  if (existingUser) {
    existingUser.name = existingUser.name || 'Super Admin';
    existingUser.username = SUPER_ADMIN_EMAIL;
    existingUser.email = SUPER_ADMIN_EMAIL;
    existingUser.password = SUPER_ADMIN_PASSWORD;
    existingUser.role = 'superadmin';
    existingUser.isActive = true;
    await existingUser.save();
    console.log(`Updated super admin: ${SUPER_ADMIN_EMAIL}`);
    return;
  }

  await User.create({
    name: 'Super Admin',
    username: SUPER_ADMIN_EMAIL,
    email: SUPER_ADMIN_EMAIL,
    password: SUPER_ADMIN_PASSWORD,
    role: 'superadmin',
    isActive: true
  });

  console.log(`Created super admin: ${SUPER_ADMIN_EMAIL}`);
};

seedSuperAdmin()
  .catch((error) => {
    console.error('Failed to seed super admin:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
