const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Verify JWT token
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Super Admin only middleware
const superAdminOnly = async (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Super Admin only.' });
  }
};

// Admin only middleware (includes superadmin)
const adminOnly = async (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};

// Auth and Employee middleware
const authAndEmployee = async (req, res, next) => {
  if (req.user && (req.user.role === 'superadmin' || req.user.role === 'admin' || req.user.role === 'employee')) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied.' });
  }
};

// Activity logger middleware
const logActivity = (action, description) => {
  return async (req, res, next) => {
    // Store the original json method
    const originalJson = res.json.bind(res);
    
    res.json = async function(data) {
      // Log activity after successful operations (status < 400)
      if (res.statusCode < 400 && req.user) {
        try {
          await ActivityLog.create({
            userId: req.user._id,
            role: req.user.role,
            action,
            description,
            ipAddress: req.ip || req.connection.remoteAddress,
            metadata: {
              method: req.method,
              path: req.path,
              params: req.params,
              body: req.body
            }
          });
        } catch (err) {
          console.error('Failed to log activity:', err);
        }
      }
      return originalJson(data);
    };
    next();
  };
};

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};

module.exports = { auth, superAdminOnly, adminOnly, authAndEmployee, logActivity, generateToken, JWT_SECRET };

