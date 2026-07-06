const mongoose = require('mongoose');

const shellMouldingInspectionEntrySchema = new mongoose.Schema({
  sheetId: { type: String, required: true, trim: true, index: true },
  productionLine: {
    type: String,
    enum: ['', 'D1', 'D2', 'D4'],
    default: '',
    index: true
  },
  inspectionStage: {
    type: String,
    enum: ['painted', 'inward', 'inprocess'],
    required: true,
    index: true
  },
  inspectedAt: { type: Date, required: true, index: true },
  rowKey: { type: String, required: true, trim: true },
  samples: {
    type: [String],
    default: ['', '', '', '', ''],
    validate: {
      validator: (value) => Array.isArray(value) && value.length <= 5,
      message: 'Samples can include at most 5 values'
    }
  },
  remarks: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

shellMouldingInspectionEntrySchema.index(
  { sheetId: 1, inspectedAt: 1, rowKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('ShellMouldingInspectionEntry', shellMouldingInspectionEntrySchema);
