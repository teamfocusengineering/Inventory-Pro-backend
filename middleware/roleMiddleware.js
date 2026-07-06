// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Access denied. Required roles: ${roles.join(', ')}` 
      });
    }

    next();
  };
};

// Middleware specifically for admin-only routes
const adminOnly = authorize('admin');

// Middleware for admin and employee (authenticated users)
const authAndEmployee = authorize('admin', 'employee');

module.exports = { authorize, adminOnly, authAndEmployee };

