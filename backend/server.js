const dotenv = require('dotenv');

dotenv.config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const mongoose = require('mongoose');
const { getJwtSecret } = require('./middleware/auth');
const { initializeOrderNumbers } = require('./utils/orderNumbers');
const paymentRoutes = require('./routes/paymentRoutes');
const { handleChapaWebhook } = require('./controllers/paymentController');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminPaymentRoutes = require('./routes/adminPaymentRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const { notFound, errorHandler } = require('./middleware/error');

// Initialize Express app
const app = express();

// Middleware: CORS configuration
const allowedOrigins = (process.env.CLIENT_URLS || process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.post(
  '/api/payments/chapa/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  handleChapaWebhook
);

// Middleware: Parse JSON bodies and URL-encoded data
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'E-Commerce Platform API is running smoothly',
    timestamp: new Date().toISOString(),
  });
});

// Root verification endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to AllStore E-Commerce REST API',
    healthCheck: '/api/health',
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      orders: '/api/orders',
    },
  });
});

// Mount application routes
app.use('/api/auth', authRoutes);
app.use('/api/admin/payments', adminPaymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  getJwtSecret();
  await connectDB();
  await initializeOrderNumbers();

  const server = await new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`🚀 [Server]: Server is running on port ${PORT}`);
      console.log(`🔗 [Health Check]: http://localhost:${PORT}/api/health`);
      resolve(server);
    });

    server.once('error', reject);
  });

  const shutdown = () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

startServer().catch((error) => {
  console.error(`❌ [Startup Error]: ${error.message}`);
  process.exitCode = 1;
});
