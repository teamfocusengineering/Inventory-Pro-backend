const User = require('../models/User');
const Dealer = require('../models/Dealer');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const ActivityLog = require('../models/ActivityLog');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const { generateToken } = require('../middleware/authMiddleware');

// @desc    Super Admin Login
// @route   POST /api/superadmin/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email, role: 'superadmin' });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(400).json({ message: 'Account is deactivated' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    // Log activity
    await ActivityLog.create({
      userId: user._id,
      role: user.role,
      action: 'LOGIN',
      description: 'Super Admin logged in',
      ipAddress: req.ip || req.connection.remoteAddress
    });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get current Super Admin
// @route   GET /api/superadmin/me
exports.getMe = async (req, res) => {
  res.json(req.user);
};

// ==================== ADMIN MANAGEMENT ====================

// @desc    Create Admin
// @route   POST /api/superadmin/admins
exports.createAdmin = async (req, res) => {
  try {
    const { name, email, phone, password, dealerId } = req.body;

    // Check if admin already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    const admin = new User({
      name,
      email,
      phone,
      password,
      role: 'admin',
      dealerId
    });

    await admin.save();

    // If dealerId provided, update dealer with adminId
    if (dealerId) {
      await Dealer.findByIdAndUpdate(dealerId, { adminId: admin._id });
    }

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'CREATE_ADMIN',
      description: `Created admin: ${admin.name} (${admin.email})`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { adminId: admin._id, dealerId }
    });

    res.status(201).json({
      message: 'Admin created successfully',
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        isActive: admin.isActive,
        dealerId: admin.dealerId,
        createdAt: admin.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get all Admins
// @route   GET /api/superadmin/admins
exports.getAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).populate('dealerId', 'dealerName').select('-password');
    res.json(admins);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get single Admin
// @route   GET /api/superadmin/admins/:id
exports.getAdmin = async (req, res) => {
  try {
    const admin = await User.findById(req.params.id).populate('dealerId', 'dealerName').select('-password');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }
    res.json(admin);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update Admin
// @route   PUT /api/superadmin/admins/:id
exports.updateAdmin = async (req, res) => {
  try {
    const { name, email, phone, isActive, dealerId } = req.body;
    
    const admin = await User.findById(req.params.id);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Check if email is being changed and if it's already in use
    if (email && email !== admin.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    admin.name = name || admin.name;
    admin.email = email || admin.email;
    admin.phone = phone || admin.phone;
    admin.isActive = isActive !== undefined ? isActive : admin.isActive;
    admin.dealerId = dealerId || admin.dealerId;

    await admin.save();

    // Update dealer if dealerId changed
    if (dealerId && dealerId !== admin.dealerId) {
      await Dealer.findByIdAndUpdate(dealerId, { adminId: admin._id });
    }

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'UPDATE_ADMIN',
      description: `Updated admin: ${admin.name}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { adminId: admin._id }
    });

    res.json({
      message: 'Admin updated successfully',
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        isActive: admin.isActive,
        dealerId: admin.dealerId,
        createdAt: admin.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete Admin
// @route   DELETE /api/superadmin/admins/:id
exports.deleteAdmin = async (req, res) => {
  try {
    const admin = await User.findById(req.params.id);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Remove adminId from associated dealer
    if (admin.dealerId) {
      await Dealer.findByIdAndUpdate(admin.dealerId, { adminId: null });
    }

    const adminName = admin.name;
    await admin.deleteOne();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'DELETE_ADMIN',
      description: `Deleted admin: ${adminName}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { deletedAdminId: req.params.id }
    });

    res.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Reset Admin password
// @route   POST /api/superadmin/admins/:id/reset-password
exports.resetAdminPassword = async (req, res) => {
  try {
    const { password } = req.body;
    
    const admin = await User.findById(req.params.id);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    admin.password = password;
    await admin.save();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'RESET_ADMIN_PASSWORD',
      description: `Reset password for admin: ${admin.name}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { adminId: admin._id }
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ==================== DEALER MANAGEMENT ====================

// @desc    Create Dealer
// @route   POST /api/superadmin/dealers
exports.createDealer = async (req, res) => {
  try {
    const { dealerName, address, contactPerson, phone, email, adminId, subscriptionPlan, vendorType, vendorCode } = req.body;

    if (!dealerName || !address || !contactPerson || !phone || !email) {
      return res.status(400).json({ message: 'Missing required fields: dealerName, address, contactPerson, phone, email are required' });
    }

    const existingDealer = await Dealer.findOne({ email });
    if (existingDealer) {
      return res.status(400).json({ message: 'Dealer with this email already exists' });
    }

    if (adminId) {
      const adminUser = await User.findById(adminId);
      if (!adminUser) {
        return res.status(400).json({ message: 'Admin user not found' });
      }
    }

    if (subscriptionPlan) {
      const plan = await SubscriptionPlan.findById(subscriptionPlan);
      if (!plan) {
        return res.status(400).json({ message: 'Subscription plan not found' });
      }
    }

    const dealer = new Dealer({
      dealerName,
      address,
      contactPerson,
      phone,
      email,
      adminId: adminId || null,
      subscriptionPlan: subscriptionPlan || null,
      vendorType: vendorType || 'get_manufacturing',
      vendorCode,
      status: 'active'
    });

    await dealer.save();

    if (adminId) {
      await User.findByIdAndUpdate(adminId, { dealerId: dealer._id });
    }

    const populatedDealer = await Dealer.findById(dealer._id)
      .populate('adminId', 'name email phone isActive')
      .populate('subscriptionPlan', 'planName price duration');

    try {
      await ActivityLog.create({
        userId: req.user._id,
        role: req.user.role,
        action: 'CREATE_DEALER',
        description: `Created dealer: ${dealer.dealerName}`,
        ipAddress: req.ip || req.connection.remoteAddress,
        metadata: { dealerId: dealer._id }
      });
    } catch (logErr) {
      console.error('Activity log error (non-critical):', logErr.message);
    }

    res.status(201).json({
      message: 'Dealer created successfully',
      dealer: populatedDealer
    });
  } catch (error) {
    console.error('Create dealer error:', error);
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get all Dealers
// @route   GET /api/superadmin/dealers
exports.getDealers = async (req, res) => {
  try {
    const dealers = await Dealer.find()
      .populate('adminId', 'name email phone isActive')
      .populate('subscriptionPlan', 'planName price duration')
      .sort({ createdAt: -1 });
    res.json(dealers);
  } catch (error) {
    console.error('Get dealers error:', error);
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get single Dealer
// @route   GET /api/superadmin/dealers/:id
exports.getDealer = async (req, res) => {
  try {
    const dealer = await Dealer.findById(req.params.id)
      .populate('adminId', 'name email phone isActive')
      .populate('subscriptionPlan', 'planName price duration features');
    
    if (!dealer) {
      return res.status(404).json({ message: 'Dealer not found' });
    }
    res.json(dealer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update Dealer
// @route   PUT /api/superadmin/dealers/:id
exports.updateDealer = async (req, res) => {
  try {
    const { dealerName, address, contactPerson, phone, email, adminId, subscriptionPlan, status } = req.body;
    
    const dealer = await Dealer.findById(req.params.id);
    if (!dealer) {
      return res.status(404).json({ message: 'Dealer not found' });
    }

    // Check if email is being changed and if it's already in use
    if (email && email !== dealer.email) {
      const existingDealer = await Dealer.findOne({ email });
      if (existingDealer) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    dealer.dealerName = dealerName || dealer.dealerName;
    dealer.address = address || dealer.address;
    dealer.contactPerson = contactPerson || dealer.contactPerson;
    dealer.phone = phone || dealer.phone;
    dealer.email = email || dealer.email;
    dealer.subscriptionPlan = subscriptionPlan || dealer.subscriptionPlan;
    dealer.status = status || dealer.status;

    // Handle admin assignment
    if (adminId !== undefined) {
      // Remove admin from old dealer
      if (dealer.adminId) {
        await User.findByIdAndUpdate(dealer.adminId, { dealerId: null });
      }
      // Assign admin to new dealer
      if (adminId) {
        await User.findByIdAndUpdate(adminId, { dealerId: dealer._id });
      }
      dealer.adminId = adminId || null;
    }

    await dealer.save();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'UPDATE_DEALER',
      description: `Updated dealer: ${dealer.dealerName}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { dealerId: dealer._id }
    });

    res.json({
      message: 'Dealer updated successfully',
      dealer
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete Dealer
// @route   DELETE /api/superadmin/dealers/:id
exports.deleteDealer = async (req, res) => {
  try {
    const dealer = await Dealer.findById(req.params.id);
    if (!dealer) {
      return res.status(404).json({ message: 'Dealer not found' });
    }

    const dealerName = dealer.dealerName;

    // Remove admin association
    if (dealer.adminId) {
      await User.findByIdAndUpdate(dealer.adminId, { dealerId: null });
    }

    // Deactivate all users associated with this dealer
    await User.updateMany({ dealerId: dealer._id }, { isActive: false });

    await dealer.deleteOne();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'DELETE_DEALER',
      description: `Deleted dealer: ${dealerName}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { deletedDealerId: req.params.id }
    });

    res.json({ message: 'Dealer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ==================== SUBSCRIPTION PLAN MANAGEMENT ====================

// @desc    Create Subscription Plan
// @route   POST /api/superadmin/plans
exports.createPlan = async (req, res) => {
  try {
    const { planName, maxProducts, maxUsers, price, duration, features, status } = req.body;

    // Check if plan already exists
    const existingPlan = await SubscriptionPlan.findOne({ planName });
    if (existingPlan) {
      return res.status(400).json({ message: 'Plan with this name already exists' });
    }

    const plan = new SubscriptionPlan({
      planName,
      maxProducts: maxProducts || 100,
      maxUsers: maxUsers || 5,
      price: price || 0,
      duration: duration || 'monthly',
      features: features || [],
      status: status || 'active'
    });

    await plan.save();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'CREATE_PLAN',
      description: `Created subscription plan: ${plan.planName}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { planId: plan._id }
    });

    res.status(201).json({
      message: 'Plan created successfully',
      plan
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get all Plans
// @route   GET /api/superadmin/plans
exports.getPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find().sort({ createdAt: -1 });
    res.json(plans);
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get single Plan
// @route   GET /api/superadmin/plans/:id
exports.getPlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update Plan
// @route   PUT /api/superadmin/plans/:id
exports.updatePlan = async (req, res) => {
  try {
    const { planName, maxProducts, maxUsers, price, duration, features, status } = req.body;
    
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    // Check if name is being changed and if it's already in use
    if (planName && planName !== plan.planName) {
      const existingPlan = await SubscriptionPlan.findOne({ planName });
      if (existingPlan) {
        return res.status(400).json({ message: 'Plan name already in use' });
      }
    }

    plan.planName = planName || plan.planName;
    plan.maxProducts = maxProducts !== undefined ? maxProducts : plan.maxProducts;
    plan.maxUsers = maxUsers !== undefined ? maxUsers : plan.maxUsers;
    plan.price = price !== undefined ? price : plan.price;
    plan.duration = duration || plan.duration;
    plan.features = features || plan.features;
    plan.status = status || plan.status;

    await plan.save();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'UPDATE_PLAN',
      description: `Updated subscription plan: ${plan.planName}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { planId: plan._id }
    });

    res.json({
      message: 'Plan updated successfully',
      plan
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete Plan
// @route   DELETE /api/superadmin/plans/:id
exports.deletePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    // Check if any dealer is using this plan
    const dealersUsingPlan = await Dealer.find({ subscriptionPlan: plan._id });
    if (dealersUsingPlan.length > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete plan. It is currently assigned to dealers.',
        dealers: dealersUsingPlan.map(d => d.dealerName)
      });
    }

    const planName = plan.planName;
    await plan.deleteOne();

    // Log activity
    await ActivityLog.create({
      userId: req.user._id,
      role: req.user.role,
      action: 'DELETE_PLAN',
      description: `Deleted subscription plan: ${planName}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      metadata: { deletedPlanId: req.params.id }
    });

    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ==================== DASHBOARD ====================

// @desc    Get Super Admin Dashboard Stats
// @route   GET /api/superadmin/dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    // Get counts
    const totalDealers = await Dealer.countDocuments();
    const activeDealers = await Dealer.countDocuments({ status: 'active' });
    const suspendedDealers = await Dealer.countDocuments({ status: 'suspended' });
    
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const activeAdmins = await User.countDocuments({ role: 'admin', isActive: true });
    
    const totalEmployees = await User.countDocuments({ role: 'employee' });
    
    // Get total products across all dealers
    const totalProducts = await Product.countDocuments();
    
    // Get low stock products
    const lowStockProducts = await Product.find({
      $expr: { $lte: ['$stockQuantity', '$minStockLevel'] }
    }).countDocuments();

    // Get active subscriptions
    const activePlans = await SubscriptionPlan.countDocuments({ status: 'active' });
    
    // Get total sales (from invoices)
    const salesData = await Invoice.aggregate([
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$totalAmount' },
          totalInvoices: { $sum: 1 }
        }
      }
    ]);

    res.json({
      totalDealers,
      activeDealers,
      suspendedDealers,
      totalAdmins,
      activeAdmins,
      totalEmployees,
      totalProducts,
      lowStockProducts,
      activePlans,
      totalSales: salesData[0]?.totalSales || 0,
      totalInvoices: salesData[0]?.totalInvoices || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ==================== ACTIVITY LOGS ====================

// @desc    Get Activity Logs
// @route   GET /api/superadmin/logs
exports.getActivityLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, role, action, startDate, endDate } = req.query;
    
    const query = {};
    
    if (role) {
      query.role = role;
    }
    
    if (action) {
      query.action = action;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const logs = await ActivityLog.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ActivityLog.countDocuments(query);

    res.json({
      logs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

