const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/authMiddleware');
const ManufacturingConfig = require('../models/ManufacturingConfig');
const Product = require('../models/Product');

router.get('/stage/:stageId', auth, async (req, res) => {
  try {
    const stageId = Number(req.params.stageId);
    const { code, productName } = req.query;

    let resolvedProductName = productName;
    if (!resolvedProductName && code) {
      const product = await Product.findOne({ code });
      resolvedProductName = product?.productName;
    }

    if (!resolvedProductName) {
      return res.json([]);
    }

    const query = { productName: resolvedProductName, 'stages.stageNumber': stageId };

    const config = await ManufacturingConfig.findOne(query);
    const stage = config?.stages?.find((item) => Number(item.stageNumber) === stageId);
    const formType = String(req.query.formType || 'inspection').toLowerCase();
    const formDefinition =
      formType === 'rejection'
        ? stage?.reviewForm?.rejectionForm
        : formType === 'rework'
          ? stage?.reviewForm?.reworkForm
          : stage?.reviewForm;
    const questions = formDefinition?.questions || formDefinition?.outcomes || [];

    if (!config || !stage || questions.length === 0) {
      return res.json([]);
    }

    res.json([
      {
        formId: formDefinition?.formId || `stage-${stageId}-${formType}`,
        formName: formDefinition?.formName || `${stage.stageName} ${formType === 'inspection' ? 'Inspection' : formType.charAt(0).toUpperCase() + formType.slice(1) + ' Analysis'} Form`,
        stageId,
        productName: config.productName,
        questions
      }
    ]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


