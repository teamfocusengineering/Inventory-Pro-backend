const express = require("express");
const router = express.Router();

const {
  createCustomer,
  getCustomers,
  updateCustomer,
  deleteCustomer,
  toggleCustomerStatus,
} = require("../controllers/customerController");

const { auth, adminOnly, authAndEmployee } = require('../middleware/authMiddleware');

router.post("/", auth, adminOnly, createCustomer);
router.get("/", auth, authAndEmployee, getCustomers);
router.put("/:id", auth, adminOnly, updateCustomer);
router.delete("/:id", auth, adminOnly, deleteCustomer);
router.patch("/status/:id", auth, adminOnly, toggleCustomerStatus);

module.exports = router;
