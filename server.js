require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const billingRoutes = require('./routes/billing');
const dashboardRoutes = require('./routes/dashboard');
const refundRequestRoutes = require('./routes/refundRequests');
const superAdminRoutes = require('./routes/superadmin');
const notificationRoutes = require('./routes/notifications');
const employeeRoutes = require('./routes/employees');
const chatbotRoutes = require('./routes/chatbot');
const productMasterRoutes = require('./routes/productMaster');
const qrCodeRoutes = require('./routes/qrCode');
const manufacturingConfigRoutes = require('./routes/manufacturingConfig');
const rawMaterialRoutes = require('./routes/rawMaterial');
const productionLogRoutes = require('./routes/productionLog');
const processingStageRoutes = require('./routes/processingStage');
const assemblyRoutes = require('./routes/assembly');
const brandModelRoutes = require('./routes/brandModel');
const ManufacturingConfig = require('./models/ManufacturingConfig');
const stageReviewConfigRoutes = require("./routes/stageReviewConfigRoutes");
const inspectionRoutes = require('./routes/inspection');
const formRoutes = require('./routes/forms');
const defectDetailRoutes = require('./routes/defectDetails');



const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
const allowedOrigins = ['https://inventory-management-frontend-rosy.vercel.app', 'http://localhost:3000'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/refund-requests', refundRequestRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/product-masters', productMasterRoutes);
app.use('/api/qr-codes', qrCodeRoutes);
app.use('/api/manufacturing-configs', manufacturingConfigRoutes);
app.use('/api/raw-materials', rawMaterialRoutes);
app.use('/api/production-logs', productionLogRoutes);
app.use('/api/processing-stages', processingStageRoutes);
app.use('/api', brandModelRoutes);
app.use('/api/assemblies', assemblyRoutes);
app.use("/api/stage-review-config", stageReviewConfigRoutes);
app.use('/api/inspection', inspectionRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/defect-details', defectDetailRoutes);

app.get('/', (req, res) => {
  res.send('Welcome to the Inventory and Billing System API - Backend Running Successfully!');
});
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: 'Internal server error', 
    error: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Connect to MongoDB and start server
const startServer = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    try {
      await ManufacturingConfig.syncIndexes();
      console.log('Manufacturing config indexes synced');
    } catch (indexError) {
      console.error('Failed to sync manufacturing config indexes:', indexError);
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;

