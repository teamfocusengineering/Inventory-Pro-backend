const mongoose = require('mongoose');

const defectDetailSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['reject', 'rework', 'both'],
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  productionLine: { type: String, default: '', index: true },
  reportType: { type: String, default: '', index: true },
  processKey: { type: String, default: '' },
  processName: { type: String, default: '' },
  partKey: { type: String, default: '' },
  partName: { type: String, default: '' },
  sortOrder: { type: Number, default: 0 },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

defectDetailSchema.index({ type: 1, name: 1 }, { unique: true });
defectDetailSchema.index({ productionLine: 1, reportType: 1, processKey: 1, partKey: 1, sortOrder: 1 });

module.exports = mongoose.model('DefectDetail', defectDetailSchema);
