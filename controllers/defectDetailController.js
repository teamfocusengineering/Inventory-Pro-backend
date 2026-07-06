const DefectDetail = require('../models/DefectDetail');
const { toKey } = require('../utils/reportClassification');

exports.getDefects = async (req, res) => {
  try {
    const query = {};
    if (req.query.type) {
      query.type = ['reject', 'rework'].includes(req.query.type)
        ? { $in: [req.query.type, 'both'] }
        : req.query.type;
    }
    if (req.query.isActive !== undefined) query.isActive = req.query.isActive === 'true';
    for (const field of ['productionLine', 'reportType', 'processKey', 'partKey']) {
      if (req.query[field]) query[field] = { $in: ['', req.query[field]] };
    }
    const defects = await DefectDetail.find(query).sort({ sortOrder: 1, type: 1, name: 1 });
    res.json(defects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createDefect = async (req, res) => {
  try {
    const { type, name, isActive, ...classification } = req.body;
    if (classification.processName && !classification.processKey) classification.processKey = toKey(classification.processName);
    if (classification.partName && !classification.partKey) classification.partKey = toKey(classification.partName);
    if (!['reject', 'rework', 'both'].includes(type)) return res.status(400).json({ message: 'type must be reject, rework, or both' });
    if (!name) return res.status(400).json({ message: 'name is required' });

    const defect = await DefectDetail.findOneAndUpdate(
      { type, name: String(name).trim() },
      { $set: { type, name: String(name).trim(), isActive: isActive ?? true, ...classification } },
      { new: true, upsert: true }
    );
    res.status(201).json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateDefect = async (req, res) => {
  try {
    if (req.body.type && !['reject', 'rework', 'both'].includes(req.body.type)) {
      return res.status(400).json({ message: 'type must be reject, rework, or both' });
    }
    const update = { ...req.body };
    if (update.processName && !update.processKey) update.processKey = toKey(update.processName);
    if (update.partName && !update.partKey) update.partKey = toKey(update.partName);
    const defect = await DefectDetail.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!defect) return res.status(404).json({ message: 'Defect detail not found' });
    res.json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteDefect = async (req, res) => {
  try {
    const defect = await DefectDetail.findByIdAndDelete(req.params.id);
    if (!defect) return res.status(404).json({ message: 'Defect detail not found' });
    res.json({ message: 'Defect detail deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
