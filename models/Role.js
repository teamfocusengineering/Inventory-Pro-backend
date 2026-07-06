const mongoose = require('mongoose');

const permissionStageSchema = new mongoose.Schema({
  stageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  stageNumber: Number,
  stageName: String
}, { _id: false });

const permissionProductSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: String,
  stages: [permissionStageSchema]
}, { _id: false });

const permissionSubcategorySchema = new mongoose.Schema({
  subcategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', default: null },
  subcategoryName: String,
  products: [permissionProductSchema]
}, { _id: false });

const permissionCategorySchema = new mongoose.Schema({
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  categoryName: String,
  subcategories: [permissionSubcategorySchema]
}, { _id: false });

const roleSchema = new mongoose.Schema({
  roleName: { type: String, required: true, trim: true },
  permissions: [permissionCategorySchema],
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  subcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory' }],
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  stages: [{ type: mongoose.Schema.Types.ObjectId }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dealerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer', default: null }
}, { timestamps: true });

roleSchema.index(
  { dealerId: 1, roleName: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

module.exports = mongoose.model('Role', roleSchema);
