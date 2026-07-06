require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
require('dotenv').config();

const DefectDetail = require('./models/DefectDetail');
const ManufacturingConfig = require('./models/ManufacturingConfig');
const Product = require('./models/Product');
const Category = require('./models/Category');
const Subcategory = require('./models/Subcategory');
const helmetDefectDetails = require('./seedData/helmetDefectDetails');
const { toKey } = require('./utils/reportClassification');

const stageDefinitions = [
  ['Shell Moulding', 'manufacturing', 'shell-moulding', 'Shell moulding Process', 'Shell'],
  ['Visor Moulding', 'processing', 'visor-moulding', 'Visor moulding Process', 'Visor'],
  ['Visor Mechanism Top Moulding', 'processing', 'visor-mechanism-top-moulding', 'Visor Top moulding Process', 'Visor Mechanism Top'],
  ['Visor Coating', 'processing', 'visor-coating', 'Visor Coating Process', 'Visor'],
  ['Chin Cover Moulding', 'processing', 'chin-cover-moulding', 'Chin Cover moulding Process', 'Chin Cover'],
  ['Spoiler Moulding', 'processing', 'spoiler-moulding', 'Spoiler moulding Process', 'Spoiler'],
  ['Helmet Assembly', 'assembly', 'helmet-assembly', 'Helmet Assembly', 'Helmet'],
  ['Stagewise Rejection', 'assembly', 'stagewise-rejection', 'Helmet assembly', 'Helmet']
].map(([stageName, stageType, reportType, processName, partName]) => ({
  stageName,
  stageType,
  reportType,
  processName,
  partName
}));

const productDefinitions = ['D1', 'D2', 'D3', 'D4'].map((productionLine) => ({
  productionLine,
  productName: `${productionLine} Helmet`,
  code: `${productionLine}-HELMET`,
  slug: `${productionLine.toLowerCase()}-helmet`,
  description: `${productionLine} helmet manufacturing and quality workflow`,
  brandName: 'Helmet',
  model: productionLine,
  type: 'Finished Good',
  subType: 'Helmet',
  unit: 'Nos',
  isActive: true,
  isDeleted: false
}));

const buildStages = (productionLine, existingStages = []) => {
  const existingByReport = new Map(existingStages.map((stage) => [stage.reportType, stage]));
  return stageDefinitions.map((stage, index) => ({
    stageNumber: index + 1,
    ...stage,
    productionLine,
    processKey: toKey(stage.processName),
    partKey: toKey(stage.partName),
    description: `${productionLine} ${stage.stageName} quality inspection`,
    requiresValidation: true,
    reviewForm: existingByReport.get(stage.reportType)?.reviewForm || { outcomes: [] }
  }));
};

const seedDefects = async () => {
  const operations = helmetDefectDetails.map((name, sortOrder) => ({
    updateOne: {
      filter: { type: 'both', name },
      update: { $set: { type: 'both', name, sortOrder, isActive: true } },
      upsert: true
    }
  }));
  return operations.length
    ? DefectDetail.bulkWrite(operations, { ordered: false })
    : { upsertedCount: 0, modifiedCount: 0 };
};

const seedCategoryTree = async () => {
  const category = await Category.findOneAndUpdate(
    { name: 'Helmet Manufacturing' },
    {
      $set: {
        name: 'Helmet Manufacturing',
        slug: 'helmet-manufacturing',
        description: 'Helmet production lines and their manufacturing quality stages',
        isActive: true
      }
    },
    { new: true, upsert: true, runValidators: true }
  );

  const subcategories = {};
  for (const productionLine of ['D1', 'D2', 'D3', 'D4']) {
    subcategories[productionLine] = await Subcategory.findOneAndUpdate(
      { name: `${productionLine} Helmet`, category: category._id },
      {
        $set: {
          name: `${productionLine} Helmet`,
          slug: `${productionLine.toLowerCase()}-helmet`,
          category: category._id,
          description: `${productionLine} helmet production line`,
          isActive: true
        }
      },
      { new: true, upsert: true, runValidators: true }
    );
  }

  return { category, subcategories };
};

const seedProductsAndStages = async ({ category, subcategories }) => {
  const totals = {
    productsCreated: 0,
    productsUpdated: 0,
    configsCreated: 0,
    configsUpdated: 0
  };

  for (const definition of productDefinitions) {
    const { productionLine, ...productData } = definition;
    productData.category = category._id;
    productData.subcategory = subcategories[productionLine]._id;
    const product = await Product.findOne({
      $or: [{ code: productData.code }, { productName: productData.productName }]
    });

    if (product) {
      Object.assign(product, productData);
      await product.save();
      totals.productsUpdated += 1;
    } else {
      await Product.create(productData);
      totals.productsCreated += 1;
    }

    const config = await ManufacturingConfig.findOne({ productName: productData.productName });
    const stages = buildStages(productionLine, config?.stages || []);
    if (config) {
      config.workflowType = `${stages.length}-step`;
      config.stages = stages;
      config.isActive = true;
      await config.save();
      totals.configsUpdated += 1;
    } else {
      await ManufacturingConfig.create({
        productName: productData.productName,
        workflowType: `${stages.length}-step`,
        stages,
        isActive: true
      });
      totals.configsCreated += 1;
    }
  }

  return totals;
};

const seedMisData = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  await mongoose.connect(process.env.MONGODB_URI);

  const defectResult = await seedDefects();
  const categoryTree = await seedCategoryTree();
  const totals = await seedProductsAndStages(categoryTree);

  console.log('MIS seed complete.');
  console.log(`Defects sourced: ${helmetDefectDetails.length}`);
  console.log(`Defects created: ${defectResult.upsertedCount || 0}`);
  console.log(`Defects updated: ${defectResult.modifiedCount || 0}`);
  console.log(`Category: ${categoryTree.category.name}`);
  console.log(`Subcategories: ${Object.keys(categoryTree.subcategories).length}`);
  console.log(`Products created: ${totals.productsCreated}`);
  console.log(`Products updated: ${totals.productsUpdated}`);
  console.log(`Configurations created: ${totals.configsCreated}`);
  console.log(`Configurations updated: ${totals.configsUpdated}`);
  console.log(`Stages per product: ${stageDefinitions.length}`);
};

seedMisData()
  .catch((error) => {
    console.error('Failed to seed MIS data:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
