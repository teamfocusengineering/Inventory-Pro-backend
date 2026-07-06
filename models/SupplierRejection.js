const mongoose = require('mongoose');

const supplierRejectionSchema = new mongoose.Schema({
  inspectedAt: { type: Date, required: true, index: true },
  partNumber: { type: String, trim: true, default: '' },
  partName: { type: String, trim: true, required: true },
  supplier: { type: String, trim: true, required: true, index: true },
  documentNumber: { type: String, trim: true, default: '' },
  rejectionQuantity: { type: Number, required: true, min: 0 },
  rejectionReason: { type: String, trim: true, default: '' },
  actionTaken: { type: String, trim: true, default: '' },
  actionDate: { type: Date },
  productionLine: {
    type: String,
    enum: ['', 'D1', 'D2', 'D3', 'D4'],
    default: ''
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

supplierRejectionSchema.index({ inspectedAt: -1, supplier: 1 });

module.exports = mongoose.model('SupplierRejection', supplierRejectionSchema);
