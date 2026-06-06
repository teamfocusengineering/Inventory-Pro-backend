const Notification = require('../models/Notification');
const User = require('../models/User');

// Get all notifications for current user
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get unread notification count
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user._id
    });
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Send message from SuperAdmin to Admin
exports.sendMessageToAdmin = async (req, res) => {
  try {
    const { adminId, title, message } = req.body;
    
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const notification = await Notification.create({
      recipient: adminId,
      sender: req.user.id,
      type: 'message',
      title: title || 'New Message from SuperAdmin',
      message: message
    });

    res.status(201).json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Send message from Admin to all employees
exports.broadcastToEmployees = async (req, res) => {
  try {
    const { title, message } = req.body;
    
    // Get all employees under this admin
    const employees = await User.find({
      role: 'employee',
      dealerId: req.user.dealerId
    }).select('_id');

    if (employees.length === 0) {
      return res.status(200).json({ 
        message: 'No employees found under your dealer account',
        count: 0 
      });
    }


    const notifications = await Promise.all(
      employees.map(emp => 
        Notification.create({
          recipient: emp._id,
          sender: req.user.id,
          type: 'message',
          title: title || 'New Message from Admin',
          message: message
        })
      )
    );

    res.status(201).json({ 
      message: `Message sent to ${notifications.length} employees`,
      count: notifications.length 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Helper function to create notification (to be used by other controllers)
exports.createNotification = async (data) => {
  try {
    const notification = await Notification.create(data);
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

// Get all users (for superadmin to send messages)
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' })
      .select('name email username isActive createdAt');
    res.json(admins);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get employees under an admin
exports.getAdminUsers = async (req, res) => {
  try {
    const { type } = req.query;
    
    let query = { dealerId: req.user.dealerId };
    if (type === 'employees') {
      query.role = 'employee';
    }

    const users = await User.find(query)
      .select('name email username role isActive createdAt');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

