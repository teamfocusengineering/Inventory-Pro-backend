const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  planName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  maxProducts: {
    type: Number,
    required: true,
    default: 100
  },
  maxUsers: {
    type: Number,
    required: true,
    default: 5
  },
  price: {
    type: Number,
    required: true,
    default: 0
  },
  duration: {
    type: String,
    required: true,
    enum: ['monthly', 'yearly', 'lifetime'],
    default: 'monthly'
  },
  features: [{
    type: String
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);

