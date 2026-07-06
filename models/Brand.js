const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, index: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

brandSchema.pre('save', function (next) {
  if (this.name) this.name = this.name.trim();
  next();
});

module.exports = mongoose.model('Brand', brandSchema);

