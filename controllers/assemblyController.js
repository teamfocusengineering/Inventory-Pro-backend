const Assembly = require('../models/Assembly');
const QRCode = require('../models/QRCode');

exports.getAllAssemblies = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { assemblyNo: { $regex: search, $options: 'i' } },
        { helmetId: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.status = status;

    const assemblies = await Assembly.find(query)
      .populate('components.qrId', 'qrId code')
      .sort({ createdAt: -1 });
    
    res.json(assemblies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAssemblyById = async (req, res) => {
  try {
    const assembly = await Assembly.findById(req.params.id)
      .populate('components.qrId', 'qrId code');
    
    if (!assembly) {
      return res.status(404).json({ message: 'Assembly not found' });
    }
    res.json(assembly);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createAssembly = async (req, res) => {
  try {
    const { helmetId, components, remarks, assembledBy } = req.body;

    for (const comp of components) {
      await QRCode.findByIdAndUpdate(comp.qrId, { 
        status: 'used_in_assembly' 
      });
    }

    const assembly = new Assembly({
      helmetId,
      components,
      finalQuantity: components.reduce((sum, c) => sum + (c.quantityUsed || 1), 0),
      assembledBy,
      remarks,
      status: 'in_progress'
    });

    await assembly.save();
    const populated = await Assembly.findById(assembly._id).populate('components.qrId', 'qrId');
    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateAssembly = async (req, res) => {
  try {
    const assembly = await Assembly.findById(req.params.id);
    if (!assembly) {
      return res.status(404).json({ message: 'Assembly not found' });
    }

    const { remarks, status } = req.body;

    if (remarks !== undefined) assembly.remarks = remarks;
    if (status) assembly.status = status;

    await assembly.save();
    res.json(assembly);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.finalizeAssembly = async (req, res) => {
  try {
    const assembly = await Assembly.findById(req.params.id);
    if (!assembly) {
      return res.status(404).json({ message: 'Assembly not found' });
    }

    assembly.status = 'finalized';
    assembly.assembledAt = new Date();
    await assembly.save();

    res.json(assembly);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAssemblyStats = async (req, res) => {
  try {
    const stats = await Assembly.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$finalQuantity' }
        }
      }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDailyAssembly = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await Assembly.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 },
          totalQuantity: { $sum: '$finalQuantity' }
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

