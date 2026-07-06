const mongoose = require('mongoose');

const dealerSchema = new mongoose.Schema({
  dealerName: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true
  },
  contactPerson: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  subscriptionPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPlan'
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active'
  },
  vendorType: {
    type: String,
    enum: ['base_manufacturing', 'get_manufacturing'],
    default: 'get_manufacturing'
  },
  vendorCode: {
    type: String,
    trim: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Dealer', dealerSchema);

