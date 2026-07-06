const mongoose = require('mongoose');
const Role = require('../models/Role');
const Category = require('../models/Category');
const Subcategory = require('../models/Subcategory');
const Product = require('../models/Product');
const ManufacturingConfig = require('../models/ManufacturingConfig');

const scopeFor = (user) => ({ dealerId: user.dealerId || null });
const ids = (values) => [...new Set((Array.isArray(values) ? values : []).map(String))];

const buildPermissionTree = async (user) => {
  const productQuery = { isDeleted: false, isActive: true };
  if (user.dealerId) {
    productQuery.$or = [
      { dealerId: user.dealerId },
      { dealerId: null },
      { dealerId: { $exists: false } }
    ];
  }

  const [categoryRecords, subcategoryRecords, products] = await Promise.all([
    Category.find({ isActive: true }).sort({ name: 1 }).lean(),
    Subcategory.find({ isActive: true }).sort({ name: 1 }).lean(),
    Product.find(productQuery)
      .populate('category', 'name isActive')
      .populate('subcategory', 'name category isActive')
      .sort({ productName: 1 })
      .lean()
  ]);
  const productNames = products.map((product) => product.productName).filter(Boolean);
  const configQuery = { productName: { $in: productNames }, isActive: true };
  if (user.dealerId) configQuery.$or = [{ dealerId: user.dealerId }, { dealerId: null }];
  const configs = await ManufacturingConfig.find(configQuery).lean();
  const configByName = new Map(configs.map((config) => [config.productName.trim().toLowerCase(), config]));
  const categories = new Map(categoryRecords.map((category) => [
    String(category._id),
    { id: String(category._id), name: category.name, subcategories: [] }
  ]));

  subcategoryRecords.forEach((subcategory) => {
    const category = categories.get(String(subcategory.category));
    if (category) category.subcategories.push({ id: String(subcategory._id), name: subcategory.name, products: [] });
  });

  products.forEach((product) => {
    if (!product.category || product.category.isActive === false) return;
    const categoryId = String(product.category._id);
    if (!categories.has(categoryId)) return;
    const category = categories.get(categoryId);
    const subcategoryId = product.subcategory && product.subcategory.isActive !== false ? String(product.subcategory._id) : null;
    let subcategory = category.subcategories.find((item) => item.id === subcategoryId);
    if (!subcategory) {
      subcategory = category.subcategories.find((item) => item.id === null);
      if (!subcategory) {
        subcategory = { id: null, name: 'Uncategorized', products: [] };
        category.subcategories.push(subcategory);
      }
    }
    const config = configByName.get(String(product.productName).trim().toLowerCase());
    subcategory.products.push({
      id: String(product._id),
      name: product.productName,
      code: product.code,
      stages: (config?.stages || []).map((stage) => ({
        id: String(stage._id),
        stageNumber: stage.stageNumber,
        name: stage.stageName || `Stage ${stage.stageNumber}`
      }))
    });
  });

  return [...categories.values()].map((category) => ({
    ...category,
    subcategories: category.subcategories.filter((subcategory) => subcategory.products.length > 0).sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return a.name.localeCompare(b.name);
    })
  })).filter((category) => category.subcategories.length > 0).sort((a, b) => a.name.localeCompare(b.name));
};

const normalizePayload = async (body, user) => {
  const roleName = String(body.roleName || '').trim();
  if (!roleName) {
    const error = new Error('Role name is required');
    error.status = 400;
    throw error;
  }

  const selectedCategories = new Set(ids(body.categories));
  const selectedSubcategories = new Set(ids(body.subcategories));
  const selectedProducts = new Set(ids(body.products));
  const selectedStages = new Set(ids(body.stages));
  const tree = await buildPermissionTree(user);
  const permissions = tree.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    subcategories: category.subcategories.map((subcategory) => {
      const products = subcategory.products.map((product) => {
        const stages = product.stages
          .filter((stage) => selectedStages.has(stage.id))
          .map((stage) => ({
            stageId: stage.id,
            stageNumber: stage.stageNumber,
            stageName: stage.name
          }));

        if (!selectedProducts.has(product.id) && stages.length === 0) return null;
        return { productId: product.id, productName: product.name, stages };
      }).filter(Boolean);

      const isSelected = subcategory.id && selectedSubcategories.has(String(subcategory.id));
      if (!isSelected && products.length === 0) return null;

      return {
        ...(subcategory.id ? { subcategoryId: subcategory.id } : {}),
        subcategoryName: subcategory.name,
        products
      };
    }).filter(Boolean)
  })).filter((category) => selectedCategories.has(category.categoryId) || category.subcategories.length);

  const categoryIds = ids(permissions.map((category) => category.categoryId));
  const subcategoryIds = ids(permissions.flatMap((category) => category.subcategories.map((subcategory) => subcategory.subcategoryId).filter(Boolean)));
  const productIds = ids(permissions.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.products.map((product) => product.productId))));
  const stageIds = ids(permissions.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.products.flatMap((product) => product.stages.map((stage) => stage.stageId)))));
  return { roleName, permissions, categories: categoryIds, subcategories: subcategoryIds, products: productIds, stages: stageIds };
};

const sendError = (res, error) => {
  if (error.code === 11000) return res.status(409).json({ message: 'A role with this name already exists' });
  if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid role ID' });
  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors || {}).map((item) => item.message).join(', ');
    return res.status(400).json({ message: message || 'Role data is invalid' });
  }
  console.error('Role operation failed:', error);
  return res.status(error.status || 500).json({ message: error.message || 'Unable to save role' });
};

exports.getPermissionTree = async (req, res) => {
  try { res.json(await buildPermissionTree(req.user)); } catch (error) { sendError(res, error); }
};

exports.getRoles = async (req, res) => {
  try { res.json(await Role.find(scopeFor(req.user)).sort({ createdAt: -1 }).select('roleName categories subcategories products stages createdAt updatedAt')); }
  catch (error) { sendError(res, error); }
};

exports.getRole = async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, ...scopeFor(req.user) });
    if (!role) return res.status(404).json({ message: 'Role not found' });
    res.json(role);
  } catch (error) { sendError(res, error); }
};

exports.createRole = async (req, res) => {
  try {
    const payload = await normalizePayload(req.body, req.user);
    const role = await Role.create({ ...payload, createdBy: req.user._id, ...scopeFor(req.user) });
    res.status(201).json(role);
  } catch (error) { sendError(res, error); }
};

exports.updateRole = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid role ID' });
    const payload = await normalizePayload(req.body, req.user);
    const role = await Role.findOneAndUpdate({ _id: req.params.id, ...scopeFor(req.user) }, payload, { new: true, runValidators: true });
    if (!role) return res.status(404).json({ message: 'Role not found' });
    res.json(role);
  } catch (error) { sendError(res, error); }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findOneAndDelete({ _id: req.params.id, ...scopeFor(req.user) });
    if (!role) return res.status(404).json({ message: 'Role not found' });
    res.json({ message: 'Role deleted successfully' });
  } catch (error) { sendError(res, error); }
};
