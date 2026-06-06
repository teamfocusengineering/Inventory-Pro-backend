const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'employee'],
    required: true
  },
  action: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  ipAddress: {
    type: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, { timestamps: true });

// Index for faster queries
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ userId: 1 });
activityLogSchema.index({ role: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);

