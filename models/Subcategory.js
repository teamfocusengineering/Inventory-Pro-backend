const mongoose = require('mongoose');

const makeSlug = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const subcategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
  category: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Category',
    required: true 
  },
  description: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

subcategorySchema.pre('save', function(next) {
  if (!this.slug) this.slug = makeSlug(`${this.category || ''}-${this.name}`);
  next();
});

subcategorySchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  const values = update.$set || update;
  if ((values.name || values.category) && !values.slug) {
    values.slug = makeSlug(`${values.category || ''}-${values.name || ''}`);
  }
  if (update.$set) update.$set = values;
  this.setUpdate(update);
  next();
});

module.exports = mongoose.model('Subcategory', subcategorySchema);
