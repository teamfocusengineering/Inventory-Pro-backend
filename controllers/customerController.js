const Customer = require("../models/Customer");
const User = require("../models/User");

exports.createCustomer = async (req, res) => {
  try {
    const { password, canLogin, ...customerData } = req.body;
    
    // Create customer first
    const customer = await Customer.create(customerData);
    
    // If canLogin is true and password is provided, create a User entry
    if (canLogin && password && customerData.email) {
      // Check if user already exists with this email
      const existingUser = await User.findOne({ email: customerData.email });
      if (!existingUser) {
        await User.create({
          name: customerData.name,
          email: customerData.email,
          password: password,
          role: 'customer',
          isActive: true
        });
      } else {
        // Update existing user to link with customer
        existingUser.name = customerData.name;
        existingUser.role = 'customer';
        existingUser.isActive = true;
        await existingUser.save();
      }
    }
    
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { password, canLogin, email, name, ...updateData } = req.body;
    
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    
    // Update customer basic info
    if (name) customer.name = name;
    if (email !== undefined) customer.email = email;
    await customer.save();
    
    // Handle user account sync
    if (email && canLogin !== undefined) {
      const existingUser = await User.findOne({ email: customer.email });
      
      if (canLogin && password) {
        // Create or update user with password
        if (existingUser) {
          existingUser.name = name || customer.name;
          existingUser.password = password;
          existingUser.role = 'customer';
          existingUser.isActive = true;
          await existingUser.save();
        } else {
          await User.create({
            name: name || customer.name,
            email: email,
            password: password,
            role: 'customer',
            isActive: true
          });
        }
      } else if (canLogin && !password && existingUser) {
        // Update user info but keep password
        existingUser.name = name || customer.name;
        existingUser.role = 'customer';
        existingUser.isActive = true;
        await existingUser.save();
      } else if (!canLogin && existingUser) {
        // Disable user access
        existingUser.isActive = false;
        await existingUser.save();
      }
    }
    
    const updated = await Customer.findById(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    
    // If customer has email, also deactivate the user account
    if (customer && customer.email) {
      await User.findOneAndUpdate(
        { email: customer.email },
        { isActive: false }
      );
    }
    
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ message: "Customer deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.toggleCustomerStatus = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Determine new status
    const newStatus = customer.status === "active" ? "inactive" : "active";
    
    // Update using findByIdAndUpdate to ensure it persists
    await Customer.findByIdAndUpdate(
      req.params.id,
      { status: newStatus },
      { new: true }
    );

    // Also update user status if email exists
    if (customer.email) {
      const newUserActiveStatus = newStatus === "active";
      await User.findOneAndUpdate(
        { email: customer.email },
        { isActive: newUserActiveStatus },
        { new: true }
      );
    }
    
    // Fetch and return the updated customer
    const updatedCustomer = await Customer.findById(req.params.id);
    res.json(updatedCustomer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
