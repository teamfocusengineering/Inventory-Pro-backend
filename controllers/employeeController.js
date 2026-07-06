const Dealer = require("../models/Dealer");
const User = require("../models/User");
const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Role = require("../models/Role");

const findScopedRole = (roleId, user) => Role.findOne({
  _id: roleId,
  dealerId: user.dealerId || null
});

const stagesFromRole = (role) => {
  const stages = (role?.permissions || []).flatMap((category) =>
    category.subcategories?.length
      ? category.subcategories.flatMap((subcategory) =>
          (subcategory.products || []).flatMap((product) => product.stages || [])
        )
      : (category.products || []).flatMap((product) => product.stages || [])
  );
  const uniqueStages = new Map();
  stages.forEach((stage) => {
    const key = `${stage.stageNumber}|${stage.stageName}`;
    if (!uniqueStages.has(key)) uniqueStages.set(key, { stageNumber: stage.stageNumber, stageName: stage.stageName });
  });
  return [...uniqueStages.values()];
};

exports.createEmployee = async (req, res) => {
  try {
    const { password, assignedRole, ...employeeData } = req.body;
    let role = null;
    let assignedStages = [];

    if (assignedRole) {
      role = await findScopedRole(assignedRole, req.user);
      if (!role) return res.status(400).json({ message: 'Selected role is invalid or unavailable' });
      assignedStages = stagesFromRole(role);
    }
    
    // Ensure employee belongs to admin's dealer
    employeeData.dealerId = req.user.dealerId;
    
    // Create user first
    const user = await User.create({
      name: employeeData.name,
      email: employeeData.email,
      phone: employeeData.phone,
      address: employeeData.address,
      password: password,
      role: 'employee',
      dealerId: req.user.dealerId,
      manufacturingLevel: assignedStages[0]?.stageNumber || 1,
      assignedStages,
      assignedRole: role?._id || null,
      isActive: true
    });

    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAdminEmployees = async (req, res) => {
  try {
    const employees = await User.find({
      role: 'employee',
      dealerId: req.user.dealerId
    }).select('name email phone address username isActive manufacturingLevel assignedStages assignedRole createdAt').populate('assignedRole', 'roleName').sort({ createdAt: -1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.dealerId.toString() !== req.user.dealerId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { password, name, email, phone, address, isActive, assignedRole } = req.body;
    
    if (name) employee.name = name;
    if (email) employee.email = email;
    if (phone) employee.phone = phone;
    if (address) employee.address = address;
    if (isActive !== undefined) employee.isActive = isActive;
    if (assignedRole !== undefined) {
      if (!assignedRole) {
        employee.assignedRole = null;
        employee.assignedStages = [];
        employee.manufacturingLevel = 1;
      } else {
        const role = await findScopedRole(assignedRole, req.user);
        if (!role) return res.status(400).json({ message: 'Selected role is invalid or unavailable' });
        const assignedStages = stagesFromRole(role);
        employee.assignedRole = role._id;
        employee.assignedStages = assignedStages;
        employee.manufacturingLevel = assignedStages[0]?.stageNumber || 1;
      }
    }
    if (password) employee.password = password;

    await employee.save();
    const updated = await User.findById(req.params.id).select('-password').populate('assignedRole', 'roleName');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.dealerId.toString() !== req.user.dealerId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Employee deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.toggleEmployeeStatus = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.dealerId.toString() !== req.user.dealerId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    employee.isActive = !employee.isActive;
    await employee.save();
    
    const updated = await User.findById(req.params.id).select('-password');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get active employees for dropdown (accessible by auth users)
exports.getActiveEmployees = async (req, res) => {
  try {
    // Build query - filter by dealerId if user has one
    const query = {
      role: 'employee',
      isActive: true
    };
    
    // Only filter by dealerId if the user has a dealerId
    if (req.user.dealerId) {
      query.dealerId = req.user.dealerId;
    }
    
    const employees = await User.find(query).select('name _id').sort({ name: 1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update employee sales target (admin only)
exports.updateSalesTarget = async (req, res) => {
  try {
    const { target } = req.body;
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.dealerId.toString() !== req.user.dealerId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (target !== undefined && target !== null) {
      employee.monthlySalesTarget = parseInt(target) || 0;
      await employee.save();
    }

    const updated = await User.findById(req.params.id)
      .select('name monthlySalesTarget salesCount isActive')
      .lean();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Reset sales count for employee (admin only, manual from-to date reset handled in UI)
exports.resetSalesCount = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.dealerId.toString() !== req.user.dealerId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    employee.salesCount = 0;
    await employee.save();

    res.json({ 
      message: 'Sales count reset successfully',
      employee: employee._id,
      newCount: 0 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get employee profile with analytics (for employee's own dashboard)
exports.getEmployeeProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get employee details
    const employee = await User.findById(userId).select('name email phone role monthlySalesTarget salesCount dealerId').lean();
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Get all invoices where this employee was the referred employee
    const invoices = await Invoice.find({
      referredEmployee: userId,
      status: 'completed'
    }).lean();
    
    // Calculate total sales
    const totalSales = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const totalOrders = invoices.length;
    
    // Calculate target progress
    const targetProgress = employee.monthlySalesTarget > 0 
      ? Math.round((totalSales / employee.monthlySalesTarget) * 100) 
      : 0;
    
    // Get top customers (by total purchases)
    const customerStats = {};
    invoices.forEach(inv => {
      const customerName = inv.customerName || 'Walk-in Customer';
      if (!customerStats[customerName]) {
        customerStats[customerName] = { name: customerName, totalSpent: 0, orderCount: 0 };
      }
      customerStats[customerName].totalSpent += inv.totalAmount;
      customerStats[customerName].orderCount += 1;
    });
    
    const topCustomers = Object.values(customerStats)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);
    
    // Get top selling products
    const productStats = {};
    invoices.forEach(inv => {
      inv.items.forEach(item => {
        if (!productStats[item.productName]) {
          productStats[item.productName] = { 
            name: item.productName, 
            code: item.code,
            quantitySold: 0, 
            revenue: 0 
          };
        }
        productStats[item.productName].quantitySold += item.quantity;
        productStats[item.productName].revenue += item.total;
      });
    });
    
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    
    // Get recent sales (last 5)
    const recentSales = invoices
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5)
      .map(inv => ({
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        amount: inv.totalAmount,
        date: inv.createdAt
      }));
    
    res.json({
      employee: {
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        role: employee.role
      },
      sales: {
        totalSales,
        totalOrders,
        monthlyTarget: employee.monthlySalesTarget,
        targetProgress,
        currentSalesCount: employee.salesCount
      },
      topCustomers,
      topProducts,
      recentSales
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
