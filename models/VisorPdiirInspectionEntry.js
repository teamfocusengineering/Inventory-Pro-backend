const mongoose = require('mongoose');

const visorPdiirInspectionEntrySchema = new mongoose.Schema({
  sheetId: { type: String, required: true, trim: true, index: true },
  productionLine: { type: String, trim: true, default: '', index: true },
  inspectionStage: { type: String, trim: true, default: 'pdiir', index: true },
  side: { type: String, enum: ['', 'LH', 'RH'], default: '', index: true },
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

visorPdiirInspectionEntrySchema.index(
  { sheetId: 1, inspectedAt: 1, rowKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('VisorPdiirInspectionEntry', visorPdiirInspectionEntrySchema);
