const mongoose = require('mongoose');

const makeSlug = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
  description: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

categorySchema.pre('save', function(next) {
  if (!this.slug) this.slug = makeSlug(this.name);
  next();
});

categorySchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  const values = update.$set || update;
  if (values.name && !values.slug) values.slug = makeSlug(values.name);
  if (update.$set) update.$set = values;
  this.setUpdate(update);
  next();
});

module.exports = mongoose.model('Category', categorySchema);
