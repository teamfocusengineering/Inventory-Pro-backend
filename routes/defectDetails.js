const express = require('express');
const router = express.Router();
const { auth, adminOnly, authAndEmployee } = require('../middleware/authMiddleware');
const defectDetailController = require('../controllers/defectDetailController');

router.get('/', auth, authAndEmployee, defectDetailController.getDefects);
router.post('/', auth, adminOnly, defectDetailController.createDefect);
router.put('/:id', auth, adminOnly, defectDetailController.updateDefect);
router.delete('/:id', auth, adminOnly, defectDetailController.deleteDefect);

module.exports = router;
