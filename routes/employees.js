const express = require("express");
const router = express.Router();

const {
  createEmployee,
  getAdminEmployees,
  updateEmployee,
  deleteEmployee,
  toggleEmployeeStatus,
  getActiveEmployees,
  updateSalesTarget,
  resetSalesCount,
  getEmployeeProfile
} = require("../controllers/employeeController");

const { auth } = require('../middleware/authMiddleware');
const { adminOnly, authAndEmployee } = require('../middleware/roleMiddleware');
const inspectionController = require('../controllers/inspectionController');


router.post("/", auth, adminOnly, createEmployee);
router.get("/", auth, adminOnly, getAdminEmployees);
router.get("/profile", auth, authAndEmployee, getEmployeeProfile);
router.put("/:id", auth, adminOnly, updateEmployee);
router.delete("/:id", auth, adminOnly, deleteEmployee);
router.patch("/status/:id", auth, adminOnly, toggleEmployeeStatus);
router.get("/active", auth, getActiveEmployees);
router.put("/target/:id", auth, adminOnly, updateSalesTarget);
router.post("/reset-count/:id", auth, adminOnly, resetSalesCount);

router.get('/products/search', auth, authAndEmployee, inspectionController.searchProductsForEmployee);
router.get('/batch-product/:key', auth, authAndEmployee, inspectionController.getBatchProductForEmployee);
router.get('/product/:code', auth, authAndEmployee, inspectionController.getProductForEmployee);
router.post('/inspection-response', auth, authAndEmployee, inspectionController.submitEmployeeInspectionResponse);
router.get('/product-history/:itemId', auth, authAndEmployee, inspectionController.getProductHistoryByItem);

module.exports = router;



