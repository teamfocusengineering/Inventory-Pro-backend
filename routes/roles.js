const express = require('express');
const { auth, adminOnly } = require('../middleware/authMiddleware');
const controller = require('../controllers/roleController');

const router = express.Router();
router.use(auth, adminOnly);
router.get('/permission-tree', controller.getPermissionTree);
router.get('/', controller.getRoles);
router.post('/', controller.createRole);
router.get('/:id', controller.getRole);
router.put('/:id', controller.updateRole);
router.delete('/:id', controller.deleteRole);

module.exports = router;
