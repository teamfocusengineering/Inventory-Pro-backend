const DefectDetail = require('../models/DefectDetail');

exports.getDefects = async (req, res) => {
  try {
    const query = {};
    if (req.query.type) query.type = req.query.type;
    if (req.query.isActive !== undefined) query.isActive = req.query.isActive === 'true';
    const defects = await DefectDetail.find(query).sort({ type: 1, name: 1 });
    res.json(defects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createDefect = async (req, res) => {
  try {
    const { type, name, isActive } = req.body;
    if (!['reject', 'rework'].includes(type)) return res.status(400).json({ message: 'type must be reject or rework' });
    if (!name) return res.status(400).json({ message: 'name is required' });

    const defect = await DefectDetail.findOneAndUpdate(
      { type, name: String(name).trim() },
      { $set: { type, name: String(name).trim(), isActive: isActive ?? true } },
      { new: true, upsert: true }
    );
    res.status(201).json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateDefect = async (req, res) => {
  try {
    const defect = await DefectDetail.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
