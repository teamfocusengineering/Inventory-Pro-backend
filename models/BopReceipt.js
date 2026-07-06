const mongoose = require('mongoose');

const bopReceiptSchema = new mongoose.Schema({
  productionLine: {
    type: String,
    enum: ['D1', 'D2', 'D3', 'D4'],
    required: true,
    index: true
  },
  partType: {
    type: String,
    enum: ['shell', 'eps', 'harness', 'visor'],
    required: true
  },
  quantity: { type: Number, required: true, min: 0 },
  receivedAt: { type: Date, required: true, index: true },
  supplier: { type: String, trim: true, default: '' },
  documentNumber: { type: String, trim: true, default: '' },
  remarks: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

bopReceiptSchema.index({ productionLine: 1, receivedAt: 1, partType: 1 });

module.exports = mongoose.model('BopReceipt', bopReceiptSchema);
