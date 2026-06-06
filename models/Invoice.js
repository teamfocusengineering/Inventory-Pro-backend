const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  code: { type: String, required: true },
  quantity: { type: Number, required: true },
  sellingPrice: { type: Number, required: true },
  total: { type: Number, required: true }
});

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true, required: true },
  items: [invoiceItemSchema],
  customerName: { type: String, default: 'Walk-in Customer' },
  subtotal: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  paymentMethod: { 
    type: String, 
    enum: ['cash', 'card', 'online'], 
    default: 'cash' 
  },
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dealerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer' }, // For multi-tenant architecture
  status: { 
    type: String, 
    enum: ['completed', 'refunded', 'cancelled'], 
    default: 'completed' 
  },
  referredEmployee: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  }
}, { timestamps: true });

// Generate invoice number before saving
invoiceSchema.pre('save', async function(next) {
  if (!this.invoiceNumber) {
    const count = await this.constructor.countDocuments();
    this.invoiceNumber = `INV-${Date.now()}-${count + 1}`;
  }
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);



