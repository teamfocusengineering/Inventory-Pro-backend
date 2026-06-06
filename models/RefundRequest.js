const mongoose = require('mongoose');

const refundItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  code: { type: String, required: true },
  quantity: { type: Number, required: true },
  sellingPrice: { type: Number, required: true },
  total: { type: Number, required: true }
});

const refundRequestSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  invoiceNumber: { type: String, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerName: { type: String, required: true },
  items: [refundItemSchema],
  subtotal: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  reason: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  adminResponse: { type: String, default: null },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  processedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('RefundRequest', refundRequestSchema);



