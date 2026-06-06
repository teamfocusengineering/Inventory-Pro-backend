const Product = require('../models/Product');
const Invoice = require('../models/Invoice');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
exports.getStats = async (req, res) => {
  try {
    // Total products count
    const totalProducts = await Product.countDocuments();

    // Low stock products count
    const lowStockCount = await Product.countDocuments({
      $expr: { $lte: ['$stockQuantity', '$minStockLevel'] }
    });

    // Total stock value (base price * quantity)
    const products = await Product.find();
    const totalStockValue = products.reduce((sum, p) => sum + (p.basePrice * p.stockQuantity), 0);

    // Total sales value (selling price * quantity)
    const totalSalesValue = products.reduce((sum, p) => sum + (p.sellingPrice * p.stockQuantity), 0);

    // Today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's sales - include all completed invoices (default status)
    const todaySales = await Invoice.aggregate([
      {
        $match: {
          createdAt: { $gte: today, $lt: tomorrow },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalInvoices: { $sum: 1 },
          totalItems: { $sum: { $size: '$items' } }
        }
      }
    ]);

    // Monthly sales - include all completed invoices
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthlySales = await Invoice.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalInvoices: { $sum: 1 }
        }
      }
    ]);

    // Total revenue - all time completed invoices
    const totalRevenueData = await Invoice.aggregate([
      {
        $match: { status: 'completed' }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    res.json({
      totalProducts,
      lowStockCount,
      totalStockValue,
      totalSalesValue,
      totalRevenue: totalRevenueData[0]?.totalRevenue || 0,
      todayRevenue: todaySales[0]?.totalRevenue || 0,
      todayInvoices: todaySales[0]?.totalInvoices || 0,
      todayItems: todaySales[0]?.totalItems || 0,
      monthlyRevenue: monthlySales[0]?.totalRevenue || 0,
      monthlyInvoices: monthlySales[0]?.totalInvoices || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get low stock products
// @route   GET /api/dashboard/low-stock
exports.getLowStock = async (req, res) => {
  try {
    const products = await Product.find({
      $expr: { $lte: ['$stockQuantity', '$minStockLevel'] }
    })
    .populate('category', 'name')
    .sort({ stockQuantity: 1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get sales data for chart (last 7 days)
// @route   GET /api/dashboard/sales-chart
exports.getSalesChart = async (req, res) => {
  try {
    // Get start of today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Go back 6 more days to get 7 days total (today + 6 days back = 7 days)
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // Get all completed invoices in the date range
    const salesData = await Invoice.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalAmount' },
          invoices: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Fill in missing days with zero values
    const chartData = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(sevenDaysAgo);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      const found = salesData.find(s => s._id === dateStr);
      chartData.push({
        date: dateStr,
        revenue: found ? found.revenue : 0,
        invoices: found ? found.invoices : 0
      });
    }

    res.json(chartData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get product count by category
// @route   GET /api/dashboard/category-distribution
exports.getCategoryDistribution = async (req, res) => {
  try {
    const distribution = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalStock: { $sum: '$stockQuantity' }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      {
        $unwind: {
          path: '$categoryInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          category: { $ifNull: ['$categoryInfo.name', 'Uncategorized'] },
          count: 1,
          totalStock: 1
        }
      }
    ]);

    res.json(distribution);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get top selling products
// @route   GET /api/dashboard/top-products
exports.getTopProducts = async (req, res) => {
  try {
    const { days = 30, limit = 10 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const topProducts = await Invoice.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          productName: { $first: '$items.productName' },
          code: { $first: '$items.code' },
          totalSold: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.total' }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json(topProducts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get employee sales progress for date range (admin only)
// @route   GET /api/dashboard/employee-sales
exports.getEmployeeSalesProgress = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    
    let matchQuery = { status: 'completed' };
    
    if (req.user.role !== 'admin') {
      matchQuery.cashier = req.user._id;
    }
    
    // Filter by dealer for multi-tenant
    if (req.user.dealerId) {
      matchQuery.dealerId = req.user.dealerId;
    }
    
    if (fromDate || toDate) {
      matchQuery.createdAt = {};
      if (fromDate) matchQuery.createdAt.$gte = new Date(fromDate);
      if (toDate) matchQuery.createdAt.$lte = new Date(toDate + 'T23:59:59.999Z');
    }

    const progressData = await Invoice.aggregate([
      {
        $match: matchQuery
      },
      {
        $group: {
          _id: '$referredEmployee',
          salesCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'employee',
          pipeline: [
            { $match: { role: 'employee', isActive: true } },
            { $project: { name: 1, monthlySalesTarget: 1, salesCount: 1 } }
          ]
        }
      },
      {
        $unwind: { path: '$employee', preserveNullAndEmptyArrays: true }
      },
      {
        $project: {
          employeeId: '$_id',
          employeeName: '$employee.name',
          salesCount: { $ifNull: ['$salesCount', 0] },
          totalRevenue: { $ifNull: ['$totalRevenue', 0] },
          target: { $ifNull: ['$employee.monthlySalesTarget', 0] },
          progressPercent: {
            $cond: {
              if: { $eq: ['$employee.monthlySalesTarget', 0] },
              then: 100,
              else: { $multiply: [{ $divide: [{ $ifNull: ['$salesCount', 0] }, '$employee.monthlySalesTarget'] }, 100] }
            }
          }
        }
      },
      { $sort: { salesCount: -1 } }
    ]);

    res.json(progressData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};




