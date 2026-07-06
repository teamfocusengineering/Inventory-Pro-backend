const mongoose = require('mongoose');

const employeeMisSheetEntrySchema = new mongoose.Schema({
  sheetId: { type: String, required: true, trim: true, index: true },
  sheetName: { type: String, trim: true, default: '' },
  rowKey: { type: String, required: true, trim: true, index: true },
  rowLabel: { type: String, trim: true, default: '' },
  productionLine: { type: String, trim: true, default: '', index: true },
  inspectedAt: { type: Date, required: true, index: true },
  day: { type: Number, required: true, min: 1, max: 31, index: true },
  value: { type: Number, min: 0, default: 0 },
  remarks: { type: String, trim: true, default: '' },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  employeeName: { type: String, trim: true, default: '' }
}, { timestamps: true });

employeeMisSheetEntrySchema.index(
  { sheetId: 1, rowKey: 1, day: 1, inspectedAt: 1, employee: 1 },
  { unique: true }
);

module.exports = mongoose.model('EmployeeMisSheetEntry', employeeMisSheetEntrySchema);
