const User = require('../models/User');
const { generateToken } = require('../middleware/authMiddleware');

const buildUsernameFromName = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

// @desc    Register a new user (Admin only)
// @route   POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = new User({ username, email, password, role });
    await user.save();

    res.status(201).json({ 
      message: 'User created successfully',
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Login user (superadmin, admin, or employee)
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(400).json({ message: 'Account is deactivated - Contact Admin' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      token,
      user: { 
        id: user._id, 
        username: user.username,
        name: user.name,
        email: user.email, 
        role: user.role 
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  res.json(req.user);
};

// @desc    Get all users (Admin only)
// @route   GET /api/auth/users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update user status (Admin only)
// @route   PUT /api/auth/user/:id
exports.updateUser = async (req, res) => {
  try {
    const { isActive, role } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (isActive !== undefined) user.isActive = isActive;
    if (role) user.role = role;

    await user.save();
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
