const mongoose = require('mongoose');

const brandModelSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

brandModelSchema.index({ brandId: 1, name: 1 }, { unique: true });

brandModelSchema.pre('save', function (next) {
  if (this.name) this.name = this.name.trim();
  next();
});

module.exports = mongoose.model('BrandModel', brandModelSchema);

