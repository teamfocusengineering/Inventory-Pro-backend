const RawMaterial = require('../models/RawMaterial');
const QRCode = require('../models/QRCode');

exports.getAllRawMaterials = async (req, res) => {
  try {
    const { search, status, code } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { batchNo: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.status = status;
    if (code) query.code = code;

    const rawMaterials = await RawMaterial.find(query)
      .populate('qrId', 'qrId code')
      .sort({ createdAt: -1 });
    
    res.json(rawMaterials);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRawMaterialById = async (req, res) => {
  try {
    const rawMaterial = await RawMaterial.findById(req.params.id)
      .populate('qrId', 'qrId code quantity');
    
    if (!rawMaterial) {
      return res.status(404).json({ message: 'Raw material not found' });
    }
    res.json(rawMaterial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createRawMaterial = async (req, res) => {
  try {
    const { qrId, code, batchNo, totalWeight, unitWeight } = req.body;

    const calculatedQty = Math.floor(totalWeight / unitWeight);
    const variance = Math.abs((totalWeight / calculatedQty) - unitWeight) / unitWeight;
    const isValid = variance <= 0.05;

    const rawMaterial = new RawMaterial({
      qrId,
      code,
      batchNo,
      totalWeight,
      unitWeight,
      calculatedQuantity: calculatedQty,
      status: isValid ? 'validated' : 'pending_validation',
      validationResult: {
        isValid,
        variance: variance * 100,
        remarks: isValid ? 'Within tolerance' : 'Weight variance exceeds tolerance'
      }
    });

    await rawMaterial.save();

    if (isValid) {
      await QRCode.findByIdAndUpdate(qrId, { 
        status: 'in_production',
        'weightData.totalWeight': totalWeight,
        'weightData.unitWeight': unitWeight,
        'weightData.calculatedQuantity': calculatedQty,
        'weightData.validated': true
      });
    }

    const populated = await RawMaterial.findById(rawMaterial._id).populate('qrId', 'qrId');
    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.validateRawMaterial = async (req, res) => {
  try {
    const rawMaterial = await RawMaterial.findById(req.params.id);
    if (!rawMaterial) {
      return res.status(404).json({ message: 'Raw material not found' });
    }

    const { isValid, variance, remarks, validatedBy } = req.body;

    rawMaterial.status = isValid ? 'validated' : 'rejected';
    rawMaterial.validationResult = {
      isValid,
      variance: variance || 0,
      remarks: remarks || ''
    };
    rawMaterial.validatedBy = validatedBy;

    await rawMaterial.save();

    if (isValid) {
      await QRCode.findByIdAndUpdate(rawMaterial.qrId, { 
        status: 'in_production',
        'weightData.validated': true
      });
    }

    res.json(rawMaterial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateRawMaterialQuantity = async (req, res) => {
  try {
    const rawMaterial = await RawMaterial.findById(req.params.id);
    if (!rawMaterial) {
      return res.status(404).json({ message: 'Raw material not found' });
    }

    const { actualQuantity } = req.body;
    rawMaterial.actualQuantity = actualQuantity;
    rawMaterial.status = 'in_production';

    await rawMaterial.save();
    res.json(rawMaterial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRawMaterialStats = async (req, res) => {
  try {
    const stats = await RawMaterial.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalWeight: { $sum: '$totalWeight' }
        }
      }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

