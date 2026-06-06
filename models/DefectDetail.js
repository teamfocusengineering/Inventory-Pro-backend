const mongoose = require('mongoose');

const defectDetailSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['reject', 'rework'],
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

defectDetailSchema.index({ type: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('DefectDetail', defectDetailSchema);
