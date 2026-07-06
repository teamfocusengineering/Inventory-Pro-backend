const BopReceipt = require('../models/BopReceipt');
const EmployeeMisSheetEntry = require('../models/EmployeeMisSheetEntry');
const ShellMouldingInspectionEntry = require('../models/ShellMouldingInspectionEntry');
const SupplierRejection = require('../models/SupplierRejection');
const VisorPdiirInspectionEntry = require('../models/VisorPdiirInspectionEntry');

const monthRange = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!parsedMonth || !parsedYear || parsedMonth < 1 || parsedMonth > 12) return null;
  return {
    $gte: new Date(parsedYear, parsedMonth - 1, 1),
    $lt: new Date(parsedYear, parsedMonth, 1)
  };
};

const listQuery = (dateField, req) => {
  const query = {};
  const range = monthRange(req.query.month, req.query.year);
  if (range) query[dateField] = range;
  if (req.query.productionLine) query.productionLine = req.query.productionLine;
  return query;
};

exports.getBopReceipts = async (req, res) => {
  try {
    const rows = await BopReceipt.find(listQuery('receivedAt', req)).sort({ receivedAt: 1, productionLine: 1, partType: 1 });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createBopReceipt = async (req, res) => {
  try {
    const receivedAt = new Date(req.body.receivedAt);
    const dayStart = new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate());
    const dayEnd = new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate() + 1);
    const row = await BopReceipt.findOneAndUpdate(
      {
        productionLine: req.body.productionLine,
        partType: req.body.partType,
        receivedAt: { $gte: dayStart, $lt: dayEnd }
      },
      { $set: { ...req.body, receivedAt: dayStart, createdBy: req.user?._id } },
      { new: true, upsert: true, runValidators: true }
    );
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateBopReceipt = async (req, res) => {
  try {
    const row = await BopReceipt.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!row) return res.status(404).json({ message: 'BOP receipt not found' });
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteBopReceipt = async (req, res) => {
  try {
    const row = await BopReceipt.findByIdAndDelete(req.params.id);
    if (!row) return res.status(404).json({ message: 'BOP receipt not found' });
    res.json({ message: 'BOP receipt deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSupplierRejections = async (req, res) => {
  try {
    const rows = await SupplierRejection.find(listQuery('inspectedAt', req)).sort({ inspectedAt: 1, createdAt: 1 });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createSupplierRejection = async (req, res) => {
  try {
    const row = await SupplierRejection.create({ ...req.body, createdBy: req.user?._id });
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateSupplierRejection = async (req, res) => {
  try {
    const row = await SupplierRejection.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!row) return res.status(404).json({ message: 'Supplier rejection not found' });
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteSupplierRejection = async (req, res) => {
  try {
    const row = await SupplierRejection.findByIdAndDelete(req.params.id);
    if (!row) return res.status(404).json({ message: 'Supplier rejection not found' });
    res.json({ message: 'Supplier rejection deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const dayRange = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return {
    start,
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  };
};

const monthDayRange = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!parsedMonth || !parsedYear || parsedMonth < 1 || parsedMonth > 12) return null;
  return {
    start: new Date(parsedYear, parsedMonth - 1, 1),
    end: new Date(parsedYear, parsedMonth, 1)
  };
};

exports.getEmployeeMisSheetEntries = async (req, res) => {
  try {
    const range = monthDayRange(req.query.month, req.query.year);
    if (!range) return res.status(400).json({ message: 'Invalid report month' });

    const query = {
      inspectedAt: { $gte: range.start, $lt: range.end }
    };
    if (req.query.sheetId) query.sheetId = req.query.sheetId;
    if (req.query.mine === 'true') query.employee = req.user?._id;

    const entries = await EmployeeMisSheetEntry.find(query)
      .sort({ sheetName: 1, rowLabel: 1, day: 1, employeeName: 1 })
      .lean();

    const aggregate = await EmployeeMisSheetEntry.aggregate([
      { $match: query },
      {
        $group: {
          _id: { sheetId: '$sheetId', rowKey: '$rowKey', day: '$day' },
          value: { $sum: '$value' },
          sheetName: { $first: '$sheetName' },
          rowLabel: { $first: '$rowLabel' },
          contributors: { $sum: 1 }
        }
      },
      { $sort: { '_id.sheetId': 1, '_id.rowKey': 1, '_id.day': 1 } }
    ]);

    res.json({ entries, aggregate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upsertEmployeeMisSheetEntry = async (req, res) => {
  try {
    const range = dayRange(req.body.inspectedAt);
    if (!range) return res.status(400).json({ message: 'Invalid inspection date' });
    const day = Number(req.body.day || new Date(range.start).getDate());
    if (!day || day < 1 || day > 31) return res.status(400).json({ message: 'Invalid day' });

    const row = await EmployeeMisSheetEntry.findOneAndUpdate(
      {
        sheetId: req.body.sheetId,
        rowKey: req.body.rowKey,
        day,
        inspectedAt: range.start,
        employee: req.user?._id
      },
      {
        $set: {
          sheetId: req.body.sheetId,
          sheetName: req.body.sheetName || '',
          rowKey: req.body.rowKey,
          rowLabel: req.body.rowLabel || '',
          productionLine: req.body.productionLine || '',
          inspectedAt: range.start,
          day,
          value: Math.max(0, Number(req.body.value) || 0),
          remarks: req.body.remarks || '',
          employee: req.user?._id,
          employeeName: req.user?.name || req.user?.username || ''
        }
      },
      { new: true, upsert: true, runValidators: true }
    );
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getShellMouldingInspectionEntries = async (req, res) => {
  try {
    const range = dayRange(req.query.inspectedAt);
    if (!range) return res.status(400).json({ message: 'Invalid inspection date' });

    const query = {
      inspectedAt: { $gte: range.start, $lt: range.end }
    };
    if (req.query.sheetId) query.sheetId = req.query.sheetId;
    if (req.query.productionLine) query.productionLine = req.query.productionLine;
    if (req.query.inspectionStage) query.inspectionStage = req.query.inspectionStage;

    const rows = await ShellMouldingInspectionEntry.find(query).sort({ sheetId: 1, rowKey: 1 });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upsertShellMouldingInspectionEntry = async (req, res) => {
  try {
    const range = dayRange(req.body.inspectedAt);
    if (!range) return res.status(400).json({ message: 'Invalid inspection date' });

    const samples = Array.from({ length: 5 }, (_, index) => String(req.body.samples?.[index] ?? ''));
    const row = await ShellMouldingInspectionEntry.findOneAndUpdate(
      {
        sheetId: req.body.sheetId,
        inspectedAt: range.start,
        rowKey: req.body.rowKey
      },
      {
        $set: {
          sheetId: req.body.sheetId,
          productionLine: req.body.productionLine || '',
          inspectionStage: req.body.inspectionStage,
          inspectedAt: range.start,
          rowKey: req.body.rowKey,
          samples,
          remarks: req.body.remarks || '',
          createdBy: req.user?._id
        }
      },
      { new: true, upsert: true, runValidators: true }
    );
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getVisorPdiirInspectionEntries = async (req, res) => {
  try {
    const range = dayRange(req.query.inspectedAt);
    if (!range) return res.status(400).json({ message: 'Invalid inspection date' });

    const query = {
      inspectedAt: { $gte: range.start, $lt: range.end }
    };
    if (req.query.sheetId) query.sheetId = req.query.sheetId;
    if (req.query.productionLine) query.productionLine = req.query.productionLine;
    if (req.query.side) query.side = req.query.side;

    const rows = await VisorPdiirInspectionEntry.find(query).sort({ sheetId: 1, rowKey: 1 });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upsertVisorPdiirInspectionEntry = async (req, res) => {
  try {
    const range = dayRange(req.body.inspectedAt);
    if (!range) return res.status(400).json({ message: 'Invalid inspection date' });

    const samples = Array.from({ length: 5 }, (_, index) => String(req.body.samples?.[index] ?? ''));
    const row = await VisorPdiirInspectionEntry.findOneAndUpdate(
      {
        sheetId: req.body.sheetId,
        inspectedAt: range.start,
        rowKey: req.body.rowKey
      },
      {
        $set: {
          sheetId: req.body.sheetId,
          productionLine: req.body.productionLine || '',
          inspectionStage: req.body.inspectionStage || 'pdiir',
          side: req.body.side || '',
          inspectedAt: range.start,
          rowKey: req.body.rowKey,
          samples,
          remarks: req.body.remarks || '',
          createdBy: req.user?._id
        }
      },
      { new: true, upsert: true, runValidators: true }
    );
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
