const User = require('../models/UsersModel');
const bcrypt = require('bcrypt');
const generateToken = require("../utility/jwt");
const AuditLog = require('../models/AuditModel'); 
const SessionLog = require('../models/SessionLogModel');

// Helper to push activity to session
const addSessionActivity = async ({ userId, action, target, details }) => {
  try {
    const session = await SessionLog.findOne({ userId }).sort({ loginAt: -1 });
    if (!session) return;
    session.activities.push({ action, target, details });
    await session.save();
  } catch (error) {
    console.error('Add session activity failed:', error);
  }
};

// Registration disabled
exports.register = async (req, res) => {
  return res.status(403).json({ 
      message: 'Registration is disabled. Please contact administrator.' 
  });
};

// User Login
exports.userLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailClean = email.toLowerCase().trim();
    const passwordClean = password.trim();

    const user = await User.findOne({ email: emailClean, role: "employee" });
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.status !== "active" || user.isActive === false) return res.status(403).json({ message: "Account is not active" });

    let isMatch = user.password.startsWith("$2") 
      ? await bcrypt.compare(passwordClean, user.password)
      : passwordClean === user.password;

    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    if (!user.password.startsWith("$2") && isMatch) {
      user.password = await bcrypt.hash(passwordClean, 10);
      await user.save();
    }

    const token = generateToken(user);

    // ✅ Audit Log
    await AuditLog.create({
      userId: user._id,
      action: "User Login",
      target: user._id,
      details: { email: user.email },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ SessionLog creation
const session = await SessionLog.create({
  userId: user._id,
  loginAt: new Date(),
  ip: req.ip,
  device: req.headers['user-agent'],
  activities: [
    {
      action: "User Login",
      target: user._id,
      details: { email: user.email },
      timestamp: new Date()
    }
  ]
});


    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
      },
      sessionId: session._id
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Login failed" });
  }
};

// User Logout
exports.userLogout = async (req, res) => {
  try {
    const session = await SessionLog.findOne({ userId: req.user.id }).sort({ loginAt: -1 });
    if (!session) return res.status(404).json({ success: false, message: 'No active session found' });

    session.logoutAt = new Date();
    await session.save();

    // ✅ Optional AuditLog for logout
    await AuditLog.create({
      userId: req.user.id,
      action: "User Logout",
      target: req.user.id,
      details: {},
      ip: req.ip,
      device: req.headers['user-agent']
    });

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Logout failed' });
  }
};

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, profilePicture } = req.body;
    const user = await User.findById(req.user.id);

    const oldData = { firstName: user.firstName, lastName: user.lastName, phone: user.phone, profilePicture: user.picture };
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.phone = phone || user.phone;
    user.picture = profilePicture || user.picture;
    await user.save();

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user.id,
      action: "Updated Profile",
      target: user._id,
      details: { oldData, newData: { firstName, lastName, phone, profilePicture } },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Updated Profile",
      target: user._id,
      details: { oldData, newData: { firstName, lastName, phone, profilePicture } }
    });

    res.status(200).json({ message: 'Profile updated successfully', user });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) return res.status(400).json({ message: 'Current password is incorrect' });

    const oldPasswordHash = user.password;
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user.id,
      action: "Changed Password",
      target: user._id,
      details: { oldPasswordHash, newPasswordHash: user.password },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Changed Password",
      target: user._id,
      details: { oldPasswordHash, newPasswordHash: user.password }
    });

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: view all sessions
exports.getAllSessions = async (req, res) => {
  try {
    const sessions = await SessionLog.find()
      .populate('userId', 'firstName lastName email role')
      .sort({ loginAt: -1 });

    res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions' });
  }
};

// Admin: view session by ID
exports.getSessionById = async (req, res) => {
  try {
    const session = await SessionLog.findById(req.params.id)
      .populate('userId', 'firstName lastName email role');

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch session' });
  }
};
