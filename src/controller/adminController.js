const User = require('../models/UsersModel');
const bcrypt = require('bcrypt'); 
const generateToken = require("../utility/jwt"); 

// ================= ADMIN LOGIN ================= 
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('LOGIN REQUEST for:', email);

    const admin = await User.findOne({ email, role: "admin" });

    if (!admin) {
      console.log('Admin not found');
      return res.status(401).json({ message: "Admin not found" });
    }

    const isMatch = await admin.matchPassword(password);

    if (!isMatch) {
      console.log('Password mismatch');
      return res.status(401).json({ message: "Invalid password" });
    }
    // Generate token
    const token = generateToken(admin);
    
    //Clean the token before sending
    const cleanToken = token.replace(/\s+/g, '');
    
    console.log('✅ Login successful');
    console.log('Token generated, length:', cleanToken.length);
    console.log('Token (no spaces):', cleanToken.substring(0, 100) + '...');

    res.json({
      _id: admin._id,
      email: admin.email,
      role: admin.role,
      token: cleanToken  
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
};


// Admin profile
exports.getAdminProfile = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user._id,
      role: "admin",
    }).select("-password");

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.json({
      // Basic
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      role: admin.role,

      // Profile
      profileImage: admin.profileImage || "",
      department: admin.department || "",
      designation: admin.designation || "",
      address: admin.address || "",

      // Account
      status: admin.status,
      isSuperAdmin: admin.isSuperAdmin,
      permissions: admin.permissions || [],

      // Meta
      lastLogin: admin.lastLogin,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    });
  } catch (error) {
    console.error("Get admin profile error:", error);
    res.status(500).json({ message: error.message });
  }
};

// update Admin Profile
exports.updateAdminProfile = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user._id,
      role: "admin",
    });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Allowed fields to update
    const {
      name,
      phone,
      profileImage,
      department,
      designation,
      address,
    } = req.body;

    // Update only if value exists
    if (name !== undefined) admin.name = name;
    if (phone !== undefined) admin.phone = phone;
    if (profileImage !== undefined) admin.profileImage = profileImage;
    if (department !== undefined) admin.department = department;
    if (designation !== undefined) admin.designation = designation;
    if (address !== undefined) admin.address = address;

    const updatedAdmin = await admin.save();

    res.json({
      message: "Admin profile updated successfully",
      admin: {
        _id: updatedAdmin._id,
        name: updatedAdmin.name,
        email: updatedAdmin.email,
        phone: updatedAdmin.phone,
        role: updatedAdmin.role,
        profileImage: updatedAdmin.profileImage,
        department: updatedAdmin.department,
        designation: updatedAdmin.designation,
        address: updatedAdmin.address,
        updatedAt: updatedAdmin.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update admin profile error:", error);
    res.status(500).json({ message: error.message });
  }
};


// ================= USER LOGIN =================
exports.userLogin = async (req, res) => {
  try {
    console.log('🔍 LOGIN ATTEMPT');
    console.log('Email received:', req.body.email);
    
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        message: "Email and password are required" 
      });
    }
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log('Normalized email:', normalizedEmail);
    
    // Find user
    const user = await User.findOne({ 
      email: normalizedEmail, 
      role: "user" 
    });
    
    console.log('User found:', user ? '✅ Yes' : '❌ No');
    
    if (!user) {
      return res.status(401).json({ 
        message: "User not found",
        hint: "Check email spelling or register first"
      });
    }
    
    console.log('User details:', {
      isActive: user.isActive,
      status: user.status,
      passwordHash: user.password.substring(0, 30) + '...'
    });
    
    // Check user status
    if (!user.isActive || user.status !== 'active') {
      return res.status(403).json({ 
        message: "Account is not active. Please contact admin." 
      });
    }
    
    // Check password
    console.log('Checking password...');
    const isMatch = await user.matchPassword(password);
    console.log('Password match result:', isMatch);
    
    if (!isMatch) {
      // If password is plain text in DB (not hashed)
      if (!user.password.startsWith('$2b$')) {
        console.log('⚠️ Password stored as plain text!');
        console.log('Stored:', user.password);
        console.log('Provided:', password);
        
        // Direct comparison
        if (user.password === password) {
          console.log('✅ Password matches (plain text)');
          // Auto-hash for next time
          const bcrypt = require('bcryptjs');
          user.password = await bcrypt.hash(password, 10);
          await user.save();
          console.log('✅ Password hashed for security');
          
          // Continue with login
          const token = generateToken(user);
          return res.json({
            _id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: user.role,
            token: token,
          });
        }
      }
      
      return res.status(401).json({ 
        message: "Invalid password",
        hint: "Try common passwords: 123456, password, admin"
      });
    }
    
    // Successful login
    const token = generateToken(user);
    console.log('✅ LOGIN SUCCESSFUL');
    
    res.json({
      _id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role,
      token: token,
    });
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      message: "Server error during login",
      error: error.message 
    });
  }
};

// Admin creates new user (only admin can do this)  
exports.createUser = async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      role,
      department,
      designation,
      phone,
      address,
      salaryType,
      rate,
      joiningDate,
      picture,
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      email,
      password, // pre-save hook will hash it
      role: role ? role.toLowerCase() : "user", // ensure valid enum
      isActive: true,
      status: "active",
      department: department || "",
      designation: designation || "",
      phone: phone || "",
      address: address || "",
      salaryType: salaryType || "",
      rate: rate || 0,
      joiningDate: joiningDate || null,
      picture: picture || "",
    });

    await newUser.save();

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: newUser._id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        status: newUser.status,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find()
            .select('-password')
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            count: users.length,
            users
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};



// Update user (admin only)
exports.adminUpdateUser = async (req, res) => {
  try {
    console.log('🔄 Admin Update User Request');
    console.log('User ID from params:', req.params.id);
    console.log('Updating user:', req.user?.email);
    console.log('Request body:', req.body);
    
    const { id } = req.params;

    // Check if User model is available
    if (!User || typeof User.findByIdAndUpdate !== 'function') {
      console.error('❌ User model not available');
      return res.status(500).json({ message: "Server configuration error" });
    }

    // First, check if user exists
    const existingUser = await User.findById(id);
    console.log('Existing user found:', existingUser ? 'Yes' : 'No');
    
    if (!existingUser) {
      console.log('❌ User not found with ID:', id);
      
      // List all users to help debug
      const allUsers = await User.find({}).select('_id email');
      console.log('Available users:', allUsers.map(u => ({ id: u._id, email: u.email })));
      
      return res.status(404).json({ 
        message: "User not found",
        requestedId: id,
        availableUsers: allUsers.map(u => u._id)
      });
    }

    const allowedFields = [
      "firstName",
      "lastName",
      "role",
      "status",
      "isActive",
      "department",
      "designation",
      "phone",
      "employeeId",
    ];

    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    console.log('Updates to apply:', updates);

    // super admin protection
    if (updates.role === "super_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Only super admin can assign super admin role" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password");

    console.log('✅ User updated successfully:', updatedUser.email);

    res.json({
      success: true,
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error('❌ Update error:', err.message);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      message: "Update failed",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};


// Delete user (admin/super admin only)
exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if trying to delete self
        if (id === req.user.id) {
            return res.status(400).json({ message: 'You cannot delete your own account' });
        }
        
        const user = await User.findById(id);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Prevent deleting super admin unless you are super admin
        if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ message: 'Cannot delete super admin' });
        }
        
        await User.findByIdAndDelete(id);
        
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};