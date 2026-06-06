const ManufacturingConfig = require('../models/ManufacturingConfig');
const ProcessingStage = require('../models/ProcessingStage');
const Product = require('../models/Product');
const QRCode = require('../models/QRCode');

const normalizeQuestions = (stage) => {
  const reviewForm = stage?.reviewForm || {};
  if (Array.isArray(reviewForm.questions)) return reviewForm.questions;
  if (Array.isArray(reviewForm.outcomes)) return reviewForm.outcomes;
  return [];
};

const resolveProductContext = async (code) => {
  const product = await Product.findOne({ code });

  const config = product
    ? await ManufacturingConfig.findOne({ productName: product.productName })
    : null;

  const stages = config?.stages?.length
    ? config.stages
    : [
        {
          stageNumber: 1,
          stageName: 'Manufacturing',
          stageType: 'manufacturing',
          reviewForm: {}
        }
      ];

  return { product, config, stages };
};

const getStageByNumber = (stages, stageNumber) =>
  stages.find((stage) => Number(stage.stageNumber) === Number(stageNumber)) || stages[0];

const getAssignedForms = (stage) => {
  const questions = normalizeQuestions(stage);
  if (questions.length === 0) return [];

  return [
    {
      formId: stage?.reviewForm?.formId || `stage-${stage.stageNumber}-admin`,
      formName: stage?.reviewForm?.formName || `${stage.stageName} Inspection`,
      questions
    }
  ];
};

const getLatestProcessingStage = async (qrCode, stageNumber) =>
  ProcessingStage.findOne({
    qrId: qrCode._id,
    stageNumber: Number(stageNumber)
  }).sort({ updatedAt: -1, createdAt: -1 });

const getItemStageStates = async (qrCode) => {
  const rows = await ProcessingStage.find({ qrId: qrCode._id }).sort({ updatedAt: -1, createdAt: -1 });
  const byStageNumber = {};

  rows.forEach((row) => {
    const key = String(row.stageNumber);
    if (!byStageNumber[key]) {
      byStageNumber[key] = {
        itemId: qrCode.qrId,
        qrCodeId: qrCode._id,
        stageNumber: row.stageNumber,
        stageName: row.stageName,
        status: row.status,
        reviewStatus: row.reviewStatus,
        rejectionReason: row.rejectionReason,
        updatedAt: row.updatedAt
      };
    }
  });

  return byStageNumber;
};

const ensureProcessingStage = async ({ qrCode, stage, operatorName }) => {
  let processingStage = await getLatestProcessingStage(qrCode, stage.stageNumber);

  if (!processingStage) {
    processingStage = await ProcessingStage.create({
      qrId: qrCode._id,
      code: qrCode.code,
      stageNumber: stage.stageNumber,
      stageName: stage.stageName,
      inputQuantity: qrCode.quantity || 1,
      operator: operatorName || 'Employee',
      status: 'pending',
      reviewStatus: 'pending'
    });
  }

  return processingStage;
};

const buildProductPayload = async (qrCode) => {
  const { product, config, stages } = await resolveProductContext(qrCode.code);
  const currentStageNumber = qrCode.currentStage > 0 ? qrCode.currentStage : stages[0]?.stageNumber || 1;
  const currentStage = getStageByNumber(stages, currentStageNumber);
  const latestStage = await getLatestProcessingStage(qrCode, currentStage.stageNumber);
  const itemStageStates = await getItemStageStates(qrCode);

  return {
    qrCode,
    product,
    config,
    stages,
    currentStage,
    latestStage,
    productInfo: {
      id: qrCode._id,
      qrId: qrCode.qrId,
      code: qrCode.code,
      partDescription: product?.description || product?.productName || '',
      productName: product?.productName || qrCode.code,
      currentStage: currentStage.stageName,
      currentStageNumber: currentStage.stageNumber,
      currentLocation: currentStage.stageName,
      manufacturingStatus: latestStage?.reviewStatus || qrCode.status || 'generated',
      generatedDate: qrCode.createdAt,
      quantity: qrCode.quantity || 0
    },
    itemState: {
      itemId: qrCode.qrId,
      qrCodeId: qrCode._id,
      status: qrCode.status || 'generated',
      currentStageNumber: currentStage.stageNumber,
      currentStageState: itemStageStates[String(currentStage.stageNumber)] || {
        itemId: qrCode.qrId,
        qrCodeId: qrCode._id,
        stageNumber: currentStage.stageNumber,
        stageName: currentStage.stageName,
        status: 'pending',
        reviewStatus: 'pending',
        rejectionReason: ''
      },
      stages: itemStageStates
    },
    forms: getAssignedForms(currentStage)
  };
};

module.exports = {
  buildProductPayload,
  ensureProcessingStage,
  getStageByNumber,
  getItemStageStates,
  resolveProductContext
};


