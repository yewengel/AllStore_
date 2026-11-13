const dotenv = require('dotenv');

dotenv.config();

const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

const EMAIL_PATTERN = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

const getAdminDetails = () => {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD before provisioning an admin.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('ADMIN_EMAIL must be a valid email address.');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long.');
  }

  return { name, email, password };
};

const createAdmin = async () => {
  let connected = false;

  try {
    const adminDetails = getAdminDetails();
    await connectDB();
    connected = true;

    await User.init();
    const existingAccount = await User.exists({ email: adminDetails.email });
    if (existingAccount) {
      throw new Error('An account with the supplied email already exists. No records were changed.');
    }

    const admin = new User({ ...adminDetails, role: 'admin' });
    await admin.save();

    console.log('✅ [Admin Provisioning]: Admin account created successfully.');
  } finally {
    if (connected && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

createAdmin().catch((error) => {
  const message = error.code === 11000
    ? 'An account with the supplied email already exists. No records were changed.'
    : error.message;
  console.error(`❌ [Admin Provisioning]: ${message}`);
  process.exitCode = 1;
});
