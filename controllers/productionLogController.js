const ProductionLog = require('../models/ProductionLog');
const QRCode = require('../models/QRCode');

exports.getAllProductionLogs = async (req, res) => {
  try {
    const { search, code, status, stage } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { producedBy: { $regex: search, $options: 'i' } }
      ];
    }

    if (code) query.code = code;
    if (status) query.status = status;
    if (stage) query.stage = parseInt(stage);

    const logs = await ProductionLog.find(query)
      .populate('qrId', 'qrId code')
      .sort({ createdAt: -1 });
    
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductionLogById = async (req, res) => {
  try {
    const log = await ProductionLog.findById(req.params.id)
      .populate('qrId', 'qrId code');
    
    if (!log) {
      return res.status(404).json({ message: 'Production log not found' });
    }
    res.json(log);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createProductionLog = async (req, res) => {
  try {
    const { qrId, code, quantity, stage, stageType, producedBy, operator, remarks } = req.body;

    const log = new ProductionLog({
      qrId,
      code,
      quantity,
      stage: stage || 1,
      // ProductionLog.stageType enum: manufacturing/processing/assembly
      // Map operator action values (QR status style) to this set.
      stageType:
        stageType === 'in_production' || stageType === 'completed' || stageType === 'void'
          ? 'manufacturing'
          : stageType === 'used_in_assembly'
            ? 'assembly'
            : stageType === 'processing'
              ? 'processing'
              : stageType || 'manufacturing',
      producedBy,
      operator,
      remarks,
      status: 'completed'
    });

    await log.save();

    // Update QR status according to operator action.
    // QRCode.status enum: generated, in_production, processing, completed, used_in_assembly, void
    let qrStatus = 'in_production';
    if (stageType === 'completed') qrStatus = 'completed';
    else if (stageType === 'void') qrStatus = 'void';
    else if (stageType === 'used_in_assembly') qrStatus = 'used_in_assembly';
    else if (stageType === 'processing') qrStatus = 'processing';
    else if (stageType === 'in_production') qrStatus = 'in_production';

    await QRCode.findByIdAndUpdate(qrId, {
      $inc: { quantity: quantity || 0 },
      status: qrStatus
    });



    const populated = await ProductionLog.findById(log._id).populate('qrId', 'qrId');
    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateProductionLog = async (req, res) => {
  try {
    const log = await ProductionLog.findById(req.params.id);
    if (!log) {
      return res.status(404).json({ message: 'Production log not found' });
    }

    const { quantity, status, remarks } = req.body;

    if (quantity !== undefined) log.quantity = quantity;
    if (status) log.status = status;
    if (remarks !== undefined) log.remarks = remarks;

    await log.save();
    res.json(log);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductionStats = async (req, res) => {
  try {
    const stats = await ProductionLog.aggregate([
      {
        $lookup: {
          from: 'qrcodes',
          localField: 'qrId',
          foreignField: '_id',
          as: 'qr'
        }
      },
      {
        $match: {
          'qr.0': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$code',
          totalQuantity: { $sum: '$quantity' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { totalQuantity: -1 }
      }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDailyProduction = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await ProductionLog.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      // Ensure quantity is numeric so group totals/counts remain accurate
      {
        $addFields: {
          quantity: { $ifNull: ['$quantity', 0] }
        }
      },
      {
        $lookup: {
          from: 'qrcodes',
          localField: 'qrId',
          foreignField: '_id',
          as: 'qr'
        }
      },
      {
        $match: {
          'qr.0': { $exists: true }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          totalQuantity: { $sum: '$quantity' },
          // Some datasets may not have quantity; ensure the count is based on documents
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

