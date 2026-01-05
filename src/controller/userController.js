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

// ================= ADMIN CONTROLLERS =================

// Admin Login
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 ADMIN LOGIN REQUEST for:', email);

    // Find admin
    const admin = await User.findOne({
      email: email.toLowerCase().trim(),
      role: "admin"
    });

    if (!admin) {
      console.log('❌ Admin not found');
      return res.status(401).json({
        success: false,
        message: "Admin not found"
      });
    }

    // Check admin-specific fields
    if (!admin.isActive || admin.status !== 'active') {
      console.log('❌ Admin account inactive');
      return res.status(403).json({
        success: false,
        message: "Admin account is not active"
      });
    }

    // Password verification
    let isMatch = false;
    if (admin.password && admin.password.startsWith("$2")) {
      isMatch = await bcrypt.compare(password, admin.password);
    } else if (admin.password) {
      isMatch = password === admin.password;
    } else {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    if (!isMatch) {
      console.log('❌ Password mismatch');
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    // Migrate legacy password to bcrypt
    if (admin.password && !admin.password.startsWith("$2") && isMatch) {
      try {
        admin.password = await bcrypt.hash(password, 10);
        await admin.save();
        console.log("✅ Admin password migrated to bcrypt");
      } catch (hashError) {
        console.error("Password migration failed:", hashError);
      }
    }

    // Generate token
    const token = generateToken(admin);

    // Clean the token before sending
    const cleanToken = token.replace(/\s+/g, '');

    console.log('✅ Admin login successful');
    console.log('Admin Level:', admin.adminLevel);
    console.log('Company:', admin.companyName);

    // Audit Log
    try {
      await AuditLog.create({
        userId: admin._id,
        action: "Admin Login",
        target: admin._id,
        details: {
          email: admin.email,
          role: admin.role,
          adminLevel: admin.adminLevel,
          timestamp: new Date()
        },
        ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        device: req.headers['user-agent'] || 'Unknown'
      });
    } catch (auditError) {
      console.error("Audit log error:", auditError);
    }

    // SessionLog creation
    let session = null;
    try {
      session = await SessionLog.create({
        userId: admin._id,
        loginAt: new Date(),
        ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        device: req.headers['user-agent'] || 'Unknown',
        userAgent: req.headers['user-agent'],
        activities: [
          {
            action: "Admin Login",
            target: admin._id.toString(),
            details: {
              email: admin.email,
              role: admin.role,
              adminLevel: admin.adminLevel
            },
            timestamp: new Date()
          }
        ]
      });
    } catch (sessionError) {
      console.error("Session log error:", sessionError);
    }

    // Update last login
    admin.lastLogin = new Date();
    admin.loginCount = (admin.loginCount || 0) + 1;
    await admin.save();

    res.json({
      success: true,
      message: "Admin login successful",
      _id: admin._id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      fullName: `${admin.firstName} ${admin.lastName}`,
      email: admin.email,
      role: admin.role,
      // Admin-specific fields
      adminLevel: admin.adminLevel,
      companyName: admin.companyName,
      adminPosition: admin.adminPosition,
      permissions: admin.permissions || [],
      isSuperAdmin: admin.isSuperAdmin || false,
      canManageUsers: admin.canManageUsers || false,
      canManagePayroll: admin.canManagePayroll || false,
      // Profile fields
      phone: admin.phone,
      picture: admin.picture,
      department: admin.department,
      designation: admin.designation,
      token: cleanToken,
      sessionId: session ? session._id : null
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Admin profile
exports.getAdminProfile = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user._id,
      role: "admin",
    }).select("-password -__v");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Viewed Admin Profile",
      target: admin._id,
      details: {}
    });

    res.json({
      success: true,
      // Basic info
      _id: admin._id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      fullName: `${admin.firstName} ${admin.lastName}`,
      email: admin.email,
      phone: admin.phone,
      role: admin.role,

      // Profile
      picture: admin.picture,
      address: admin.address,
      department: admin.department,
      designation: admin.designation,
      employeeId: admin.employeeId,

      // Salary info (if exists for admin)
      salaryType: admin.salaryType,
      rate: admin.rate,
      basicSalary: admin.basicSalary,
      salary: admin.salary,
      joiningDate: admin.joiningDate,
      salaryRule: admin.salaryRule,

      // Admin-specific info
      companyName: admin.companyName,
      adminPosition: admin.adminPosition,
      adminLevel: admin.adminLevel,
      permissions: admin.permissions || [],
      isSuperAdmin: admin.isSuperAdmin || false,
      canManageUsers: admin.canManageUsers || false,
      canManagePayroll: admin.canManagePayroll || false,

      // Account status
      status: admin.status,
      isActive: admin.isActive,

      // Meta
      lastLogin: admin.lastLogin,
      loginCount: admin.loginCount || 0,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    });
  } catch (error) {
    console.error("Get admin profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Update Admin Profile
exports.updateAdminProfile = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user._id,
      role: "admin",
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    // Store old data for comparison
    const oldData = {
      firstName: admin.firstName,
      lastName: admin.lastName,
      phone: admin.phone,
      address: admin.address,
      department: admin.department,
      designation: admin.designation,
      companyName: admin.companyName,
      adminPosition: admin.adminPosition,
      adminLevel: admin.adminLevel,
      picture: admin.picture
    };

    // Update fields
    const {
      firstName,
      lastName,
      phone,
      address,
      department,
      designation,
      companyName,
      adminPosition,
      adminLevel,
      permissions,
      isSuperAdmin,
      canManageUsers,
      canManagePayroll,
      employeeId,
      salaryType,
      rate,
      basicSalary,
      salary,
      joiningDate,
      picture
    } = req.body;

    // Basic fields
    if (firstName !== undefined) admin.firstName = firstName;
    if (lastName !== undefined) admin.lastName = lastName;
    if (phone !== undefined) admin.phone = phone;
    if (address !== undefined) admin.address = address;
    if (department !== undefined) admin.department = department;
    if (designation !== undefined) admin.designation = designation;
    if (employeeId !== undefined) admin.employeeId = employeeId;
    if (picture !== undefined) admin.picture = picture;

    // Admin-specific fields
    if (companyName !== undefined) admin.companyName = companyName;
    if (adminPosition !== undefined) admin.adminPosition = adminPosition;
    if (adminLevel !== undefined) admin.adminLevel = adminLevel;
    if (permissions !== undefined) admin.permissions = permissions;
    if (isSuperAdmin !== undefined) admin.isSuperAdmin = isSuperAdmin;
    if (canManageUsers !== undefined) admin.canManageUsers = canManageUsers;
    if (canManagePayroll !== undefined) admin.canManagePayroll = canManagePayroll;

    // Salary fields (optional for admin)
    if (salaryType !== undefined) admin.salaryType = salaryType;
    if (rate !== undefined) admin.rate = rate;
    if (basicSalary !== undefined) admin.basicSalary = basicSalary;
    if (salary !== undefined) admin.salary = salary;
    if (joiningDate !== undefined) admin.joiningDate = joiningDate;

    const updatedAdmin = await admin.save();

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user._id,
      action: "Updated Admin Profile",
      target: admin._id,
      details: {
        oldData,
        newData: {
          firstName: updatedAdmin.firstName,
          lastName: updatedAdmin.lastName,
          phone: updatedAdmin.phone,
          address: updatedAdmin.address,
          department: updatedAdmin.department,
          designation: updatedAdmin.designation,
          companyName: updatedAdmin.companyName,
          adminPosition: updatedAdmin.adminPosition,
          adminLevel: updatedAdmin.adminLevel,
          picture: updatedAdmin.picture
        },
        updatedFields: Object.keys(req.body).filter(key => req.body[key] !== undefined)
      },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Updated Admin Profile",
      target: admin._id,
      details: {
        updatedFields: Object.keys(req.body).filter(key => req.body[key] !== undefined)
      }
    });

    res.json({
      success: true,
      message: "Admin profile updated successfully",
      admin: {
        _id: updatedAdmin._id,
        firstName: updatedAdmin.firstName,
        lastName: updatedAdmin.lastName,
        email: updatedAdmin.email,
        phone: updatedAdmin.phone,
        role: updatedAdmin.role,
        // Profile
        picture: updatedAdmin.picture,
        address: updatedAdmin.address,
        department: updatedAdmin.department,
        designation: updatedAdmin.designation,
        employeeId: updatedAdmin.employeeId,
        // Admin-specific
        companyName: updatedAdmin.companyName,
        adminPosition: updatedAdmin.adminPosition,
        adminLevel: updatedAdmin.adminLevel,
        permissions: updatedAdmin.permissions,
        isSuperAdmin: updatedAdmin.isSuperAdmin,
        canManageUsers: updatedAdmin.canManageUsers,
        canManagePayroll: updatedAdmin.canManagePayroll,
        // Salary
        salaryType: updatedAdmin.salaryType,
        rate: updatedAdmin.rate,
        basicSalary: updatedAdmin.basicSalary,
        salary: updatedAdmin.salary,
        joiningDate: updatedAdmin.joiningDate,
        // Status
        status: updatedAdmin.status,
        isActive: updatedAdmin.isActive,
        updatedAt: updatedAdmin.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update admin profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ================= USER MANAGEMENT (ADMIN ONLY) =================

// CREATE USER (ADMIN ONLY)
// createUser function-এ এই changes করুন:

exports.createUser = async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      role = 'employee',
      phone,
      address,
      department,
      designation,
      employeeId,
      picture,
      salaryType,
      rate,
      basicSalary,
      salary,
      joiningDate,
      companyName,
      adminPosition,
      adminLevel,
      permissions,
      isSuperAdmin,
      canManageUsers,
      canManagePayroll,
      managerId,
      attendanceId,
      shiftTiming
    } = req.body;

    console.log('📝 Creating user with data:', {
      email,
      role,
      firstName,
      lastName,
      employeeId
    });

    // Check if user already exists
    const existingUser = await User.findOne({ 
      email: email.toLowerCase().trim() 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email"
      });
    }

    // Validate role
    const validRoles = ['admin', 'employee'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be 'admin' or 'employee'"
      });
    }

    // Prepare base user data
    const userData = {
      firstName: firstName || '',
      lastName: lastName || '',
      email: email.toLowerCase().trim(),
      password: password || 'defaultPassword123', // Temporary if not provided
      role: role,
      isActive: true,
      status: 'active',
      phone: phone || '',
      address: address || '',
      department: department || '',
      designation: designation || '',
      picture: picture || '',
      salaryType: salaryType || 'monthly',
      rate: rate || 0,
      basicSalary: basicSalary || 0,
      salary: salary || 0,
      joiningDate: joiningDate ? new Date(joiningDate) : new Date()
    };

    // 🔹 CRITICAL FIX: employeeId handle
    if (role === 'employee') {
      // যদি employeeId provide করা থাকে
      if (employeeId && employeeId.trim() !== '') {
        // Check if employeeId already exists
        const existingEmpId = await User.findOne({ employeeId: employeeId.trim() });
        if (existingEmpId) {
          return res.status(400).json({
            success: false,
            message: "Employee ID already exists"
          });
        }
        userData.employeeId = employeeId.trim();
      }
      // else: model-এর pre-save hook auto-generate করবে
    } else {
      // Admin-দের জন্য employeeId empty string
      userData.employeeId = '';
    }

    // Role-specific fields
    if (role === 'admin') {
      userData.companyName = companyName || 'Default Company';
      userData.adminPosition = adminPosition || 'Administrator';
      userData.adminLevel = adminLevel || 'admin';
      userData.permissions = permissions || ['user:read', 'user:create', 'user:update'];
      userData.isSuperAdmin = isSuperAdmin || false;
      userData.canManageUsers = canManageUsers !== undefined ? canManageUsers : true;
      userData.canManagePayroll = canManagePayroll !== undefined ? canManagePayroll : true;
    }

    if (role === 'employee') {
      userData.managerId = managerId || null;
      userData.attendanceId = attendanceId || '';
      userData.shiftTiming = shiftTiming || { start: '09:00', end: '18:00' };
    }

    console.log('Final user data before save:', JSON.stringify(userData, null, 2));

    // Create new user
    const newUser = new User(userData);
    await newUser.save();

    console.log('✅ User created successfully:', {
      id: newUser._id,
      email: newUser.email,
      role: newUser.role,
      employeeId: newUser.employeeId
    });

    // Remove password from response
    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: userResponse
    });

  } catch (error) {
    console.error('❌ Create user error details:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      console.error('Validation errors:', messages);
      return res.status(400).json({ 
        success: false,
        message: `Validation failed: ${messages.join(', ')}`
      });
    }
    
    // Handle duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const value = error.keyValue[field];
      console.error('Duplicate key error:', { field, value });
      return res.status(400).json({
        success: false,
        message: `${field} '${value}' already exists`
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const { role, status, department, search } = req.query;

    // Build query
    const query = {};

    if (role) query.role = role;
    if (status) query.status = status;
    if (department) query.department = department;

    // Search functionality
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password -__v')
      .sort({ createdAt: -1 });

    // Format response based on role
    const formattedUsers = users.map(user => {
      const userObj = user.toObject();

      // Add fullName
      userObj.fullName = `${user.firstName} ${user.lastName}`;

      // Remove sensitive admin fields if not admin
      if (req.user.role !== 'admin' && user.role === 'admin') {
        delete userObj.permissions;
        delete userObj.isSuperAdmin;
        delete userObj.adminLevel;
        delete userObj.companyName;
      }

      return userObj;
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Viewed All Users",
      target: null,
      details: {
        filter: { role, status, department, search },
        count: users.length
      }
    });

    res.status(200).json({
      success: true,
      count: users.length,
      users: formattedUsers
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Update user (admin only)
exports.adminUpdateUser = async (req, res) => {
  try {
    console.log('🔄 Admin Update User Request');
    console.log('User ID:', req.params.id);
    console.log('Updating user by:', req.user?.email);
    console.log('Request body:', req.body);

    const { id } = req.params;

    // Check if user exists
    const existingUser = await User.findById(id);

    if (!existingUser) {
      console.log('❌ User not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    console.log('Updating user:', existingUser.email, 'Role:', existingUser.role);

    // Store old data for audit
    const oldData = {
      firstName: existingUser.firstName,
      lastName: existingUser.lastName,
      phone: existingUser.phone,
      address: existingUser.address,
      department: existingUser.department,
      designation: existingUser.designation,
      employeeId: existingUser.employeeId,
      status: existingUser.status,
      isActive: existingUser.isActive,
      role: existingUser.role,
      // Admin fields
      companyName: existingUser.companyName,
      adminPosition: existingUser.adminPosition,
      adminLevel: existingUser.adminLevel,
      permissions: existingUser.permissions,
      isSuperAdmin: existingUser.isSuperAdmin,
      canManageUsers: existingUser.canManageUsers,
      canManagePayroll: existingUser.canManagePayroll
    };

    // Define allowed fields to update
    const updates = {};

    // Common fields
    const commonFields = [
      "firstName",
      "lastName",
      "phone",
      "address",
      "department",
      "designation",
      "employeeId",
      "picture",
      "status",
      "isActive",
      // Salary fields
      "salaryType",
      "rate",
      "basicSalary",
      "salary",
      "joiningDate"
    ];

    // Role-specific fields
    const adminFields = [
      "companyName",
      "adminPosition",
      "adminLevel",
      "permissions",
      "isSuperAdmin",
      "canManageUsers",
      "canManagePayroll"
    ];

    const employeeFields = [
      "managerId",
      "attendanceId",
      "shiftTiming"
    ];

    // Role change check
    if (req.body.role && req.body.role !== existingUser.role) {
      // Only super admin can change roles
      if (req.user.adminLevel !== 'super' && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only super admin can change user roles"
        });
      }
      updates.role = req.body.role;
    }

    // Add common fields to updates
    commonFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Add role-specific fields
    if (existingUser.role === 'admin' || req.body.role === 'admin') {
      adminFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];

          // Super admin protection
          if (field === 'isSuperAdmin' && req.body[field] === true) {
            if (req.user.adminLevel !== 'super' && !req.user.isSuperAdmin) {
              return res.status(403).json({
                success: false,
                message: "Only super admin can assign super admin status"
              });
            }
          }
        }
      });
    }

    if (existingUser.role === 'employee' || req.body.role === 'employee') {
      employeeFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });
    }

    console.log('Updates to apply:', updates);

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
        context: 'query'
      }
    ).select("-password -__v");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found after update"
      });
    }

    console.log('✅ User updated successfully:', updatedUser.email);

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user._id,
      action: "Updated User",
      target: updatedUser._id,
      details: {
        oldData,
        newData: {
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          phone: updatedUser.phone,
          address: updatedUser.address,
          department: updatedUser.department,
          designation: updatedUser.designation,
          employeeId: updatedUser.employeeId,
          status: updatedUser.status,
          isActive: updatedUser.isActive,
          role: updatedUser.role,
          companyName: updatedUser.companyName,
          adminPosition: updatedUser.adminPosition,
          adminLevel: updatedUser.adminLevel,
          permissions: updatedUser.permissions,
          isSuperAdmin: updatedUser.isSuperAdmin,
          canManageUsers: updatedUser.canManageUsers,
          canManagePayroll: updatedUser.canManagePayroll
        },
        updatedFields: Object.keys(updates)
      },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Updated User",
      target: updatedUser._id,
      details: {
        email: updatedUser.email,
        updatedFields: Object.keys(updates)
      }
    });

    res.json({
      success: true,
      message: "User updated successfully",
      user: {
        ...updatedUser.toObject(),
        fullName: `${updatedUser.firstName} ${updatedUser.lastName}`
      }
    });
  } catch (err) {
    console.error('❌ Update error:', err.message);

    // Handle validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
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
    if (id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting super admin unless you are super admin
    if ((user.isSuperAdmin || user.adminLevel === 'super') &&
      (req.user.adminLevel !== 'super' && !req.user.isSuperAdmin)) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete super admin without super admin privileges'
      });
    }

    await User.findByIdAndDelete(id);

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user._id,
      action: "Deleted User",
      target: id,
      details: {
        deletedUserEmail: user.email,
        deletedUserRole: user.role,
        deletedBy: req.user.email
      },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Deleted User",
      target: id,
      details: {
        email: user.email,
        role: user.role
      }
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Change Admin Password
exports.changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await User.findById(req.user._id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Password verification
    let isPasswordValid = false;
    if (admin.password && admin.password.startsWith("$2")) {
      isPasswordValid = await bcrypt.compare(currentPassword, admin.password);
    } else if (admin.password) {
      isPasswordValid = currentPassword === admin.password;
    }

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Store old hash for audit
    const oldPasswordHash = admin.password;

    // Update password
    admin.password = newPassword; // pre-save hook will hash it
    await admin.save();

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user._id,
      action: "Changed Admin Password",
      target: admin._id,
      details: {
        oldPasswordHash: oldPasswordHash.substring(0, 20) + '...',
        newPasswordHash: admin.password.substring(0, 20) + '...'
      },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Changed Password",
      target: admin._id,
      details: {}
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change admin password error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get User Statistics (Admin Dashboard)
exports.getUserStatistics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active', isActive: true });
    const adminUsers = await User.countDocuments({ role: 'admin' });
    const employeeUsers = await User.countDocuments({ role: 'employee' });

    // Department statistics
    const departmentStats = await User.aggregate([
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Recent users (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentUsers = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Viewed User Statistics",
      target: null,
      details: {
        statistics: {
          totalUsers,
          activeUsers,
          recentUsers
        }
      }
    });

    res.status(200).json({
      success: true,
      statistics: {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        adminUsers,
        employeeUsers,
        recentUsers,
        departmentStats
      }
    });
  } catch (error) {
    console.error('Get user statistics error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ================= USER CONTROLLERS =================

// User Login
exports.userLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 USER LOGIN ATTEMPT - DEBUG MODE');
    console.log('Email:', email);
    console.log('Password length:', password?.length);

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const emailClean = email.toLowerCase().trim();
    const passwordClean = password.trim();

    // Find user
    console.log('🔍 Searching user with email:', emailClean);
    const user = await User.findOne({
      email: emailClean,
      isDeleted: false
    });

    if (!user) {
      console.log('❌ User not found in database');
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    console.log('✅ User found:', {
      id: user._id,
      email: user.email,
      role: user.role,
      status: user.status,
      isActive: user.isActive,
      passwordHashExists: !!user.password,
      passwordHashLength: user.password?.length,
      passwordHashPrefix: user.password?.substring(0, 30) + '...'
    });

    // Check user role
    if (user.role.toLowerCase() !== "employee") {
      console.log('❌ Invalid role:', user.role);
      return res.status(403).json({
        success: false,
        message: "Access restricted to employees only"
      });
    }

    // Check account status
    if (user.status !== "active" || user.isActive !== true) {
      console.log('❌ Account not active:', {
        status: user.status,
        isActive: user.isActive
      });
      return res.status(403).json({
        success: false,
        message: "Account is not active. Please contact administrator."
      });
    }

    // 🔹 **Password verification - FIXED VERSION**
    console.log('🔐 Password verification process:');
    console.log('- Input password:', passwordClean);
    console.log('- Stored password type:', user.password?.substring(0, 30) + '...');
    
    let isMatch = false;
    let usedMethod = '';
    
    try {
      // Method 1: Try the matchPassword method first
      console.log('- Trying matchPassword method...');
      if (typeof user.matchPassword === 'function') {
        isMatch = await user.matchPassword(passwordClean);
        usedMethod = 'matchPassword';
        console.log('- matchPassword result:', isMatch);
      }
      
      // Method 2: If matchPassword doesn't work or returns false, try direct bcrypt
      if (!isMatch && user.password && user.password.startsWith('$2')) {
        console.log('- Trying direct bcrypt.compare...');
        isMatch = await bcrypt.compare(passwordClean, user.password);
        usedMethod = 'directBcrypt';
        console.log('- bcrypt.compare result:', isMatch);
      }
      
      // Method 3: If still not matching, check if password is plain text
      if (!isMatch && user.password && !user.password.startsWith('$2')) {
        console.log('- Trying plain text comparison...');
        isMatch = passwordClean === user.password;
        usedMethod = 'plainText';
        console.log('- Plain text comparison result:', isMatch);
        
        // If plain text matches, migrate to bcrypt
        if (isMatch) {
          console.log('🔄 Migrating plain password to bcrypt...');
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(passwordClean, salt);
          await user.save();
          console.log('✅ Password migrated to bcrypt');
        }
      }
      
    } catch (passwordError) {
      console.error('❌ Password verification error:', passwordError);
      return res.status(500).json({
        success: false,
        message: "Authentication system error"
      });
    }
    
    console.log('- Final password check result:', isMatch);
    console.log('- Method used:', usedMethod);

    if (!isMatch) {
      console.log('❌ All password verification methods failed');
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    console.log('✅ Password verified successfully');

    // Generate token
    const token = generateToken(user);

    // Update last login
    user.lastLogin = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save();

    // Return response
    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        role: user.role,
        department: user.department,
        designation: user.designation,
        employeeId: user.employeeId,
        picture: user.picture,
        phone: user.phone,
        status: user.status,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        loginCount: user.loginCount
      }
    });

  } catch (error) {
    console.error("❌ LOGIN ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// User Logout
exports.userLogout = async (req, res) => {
  try {
    const session = await SessionLog.findOne({ userId: req.user.id }).sort({ loginAt: -1 });
    if (!session) return res.status(404).json({ success: false, message: 'No active session found' });

    session.logoutAt = new Date();
    await session.save();

    // ✅ AuditLog for logout
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
    const user = await User.findById(req.user.id)
      .select('-password -__v')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Viewed Profile",
      target: user._id,
      details: {}
    });

    // Format response
    const userResponse = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      address: user.address,
      department: user.department,
      designation: user.designation,
      employeeId: user.employeeId,
      salaryType: user.salaryType,
      rate: user.rate,
      basicSalary: user.basicSalary,
      salary: user.salary,
      joiningDate: user.joiningDate,
      picture: user.picture,
      status: user.status,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      // Role-based fields
      ...(user.role === 'admin' && {
        companyName: user.companyName,
        adminPosition: user.adminPosition,
        adminLevel: user.adminLevel,
        permissions: user.permissions,
        isSuperAdmin: user.isSuperAdmin,
        canManageUsers: user.canManageUsers,
        canManagePayroll: user.canManagePayroll
      }),
      ...(user.role === 'employee' && {
        managerId: user.managerId,
        attendanceId: user.attendanceId,
        shiftTiming: user.shiftTiming
      })
    };

    res.status(200).json({
      success: true,
      user: userResponse
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch profile'
    });
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      address,
      department,
      designation,
      employeeId,
      salaryType,
      rate,
      basicSalary,
      salary,
      joiningDate,
      // Admin-specific fields
      companyName,
      adminPosition,
      adminLevel,
      permissions,
      isSuperAdmin,
      canManageUsers,
      canManagePayroll,
      // Employee-specific fields
      managerId,
      attendanceId,
      shiftTiming,
      // Profile
      profilePicture
    } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Store old data for audit log
    const oldData = {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      address: user.address,
      department: user.department,
      designation: user.designation,
      employeeId: user.employeeId,
      salaryType: user.salaryType,
      rate: user.rate,
      basicSalary: user.basicSalary,
      salary: user.salary,
      joiningDate: user.joiningDate,
      picture: user.picture,
      // Admin fields
      companyName: user.companyName,
      adminPosition: user.adminPosition,
      adminLevel: user.adminLevel,
      permissions: user.permissions,
      isSuperAdmin: user.isSuperAdmin,
      canManageUsers: user.canManageUsers,
      canManagePayroll: user.canManagePayroll,
      // Employee fields
      managerId: user.managerId,
      attendanceId: user.attendanceId,
      shiftTiming: user.shiftTiming
    };

    // Update basic fields
    user.firstName = firstName !== undefined ? firstName : user.firstName;
    user.lastName = lastName !== undefined ? lastName : user.lastName;
    user.phone = phone !== undefined ? phone : user.phone;
    user.address = address !== undefined ? address : user.address;
    user.department = department !== undefined ? department : user.department;
    user.designation = designation !== undefined ? designation : user.designation;
    user.employeeId = employeeId !== undefined ? employeeId : user.employeeId;
    user.salaryType = salaryType !== undefined ? salaryType : user.salaryType;
    user.rate = rate !== undefined ? rate : user.rate;
    user.basicSalary = basicSalary !== undefined ? basicSalary : user.basicSalary;
    user.salary = salary !== undefined ? salary : user.salary;
    user.joiningDate = joiningDate !== undefined ? joiningDate : user.joiningDate;
    user.picture = profilePicture !== undefined ? profilePicture : user.picture;

    // Role-based updates
    if (user.role === 'admin') {
      user.companyName = companyName !== undefined ? companyName : user.companyName;
      user.adminPosition = adminPosition !== undefined ? adminPosition : user.adminPosition;
      user.adminLevel = adminLevel !== undefined ? adminLevel : user.adminLevel;
      user.permissions = permissions !== undefined ? permissions : user.permissions;
      user.isSuperAdmin = isSuperAdmin !== undefined ? isSuperAdmin : user.isSuperAdmin;
      user.canManageUsers = canManageUsers !== undefined ? canManageUsers : user.canManageUsers;
      user.canManagePayroll = canManagePayroll !== undefined ? canManagePayroll : user.canManagePayroll;
    }

    if (user.role === 'employee') {
      user.managerId = managerId !== undefined ? managerId : user.managerId;
      user.attendanceId = attendanceId !== undefined ? attendanceId : user.attendanceId;
      user.shiftTiming = shiftTiming !== undefined ? shiftTiming : user.shiftTiming;
    }

    // Save updated user
    await user.save();

    // Prepare new data for audit log
    const newData = {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      address: user.address,
      department: user.department,
      designation: user.designation,
      employeeId: user.employeeId,
      salaryType: user.salaryType,
      rate: user.rate,
      basicSalary: user.basicSalary,
      salary: user.salary,
      joiningDate: user.joiningDate,
      picture: user.picture,
      // Admin fields
      companyName: user.companyName,
      adminPosition: user.adminPosition,
      adminLevel: user.adminLevel,
      permissions: user.permissions,
      isSuperAdmin: user.isSuperAdmin,
      canManageUsers: user.canManageUsers,
      canManagePayroll: user.canManagePayroll,
      // Employee fields
      managerId: user.managerId,
      attendanceId: user.attendanceId,
      shiftTiming: user.shiftTiming
    };

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user.id,
      action: "Updated Profile",
      target: user._id,
      details: {
        oldData,
        newData,
        updatedFields: Object.keys(req.body).filter(key => req.body[key] !== undefined)
      },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Updated Profile",
      target: user._id,
      details: {
        updatedFields: Object.keys(req.body).filter(key => req.body[key] !== undefined)
      }
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address,
        department: user.department,
        designation: user.designation,
        employeeId: user.employeeId,
        salaryType: user.salaryType,
        rate: user.rate,
        basicSalary: user.basicSalary,
        salary: user.salary,
        joiningDate: user.joiningDate,
        picture: user.picture,
        companyName: user.companyName,
        adminPosition: user.adminPosition,
        adminLevel: user.adminLevel,
        permissions: user.permissions,
        isSuperAdmin: user.isSuperAdmin,
        canManageUsers: user.canManageUsers,
        canManagePayroll: user.canManagePayroll,
        managerId: user.managerId,
        attendanceId: user.attendanceId,
        shiftTiming: user.shiftTiming,
        status: user.status,
        isActive: user.isActive
      }
    });

  } catch (error) {
    console.error('Update Profile Error:', error);

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate field value entered'
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update profile'
    });
  }
};

// Change password (for all users)
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    // Password verification
    let isPasswordValid = false;
    if (user.password && user.password.startsWith("$2")) {
      isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    } else if (user.password) {
      isPasswordValid = currentPassword === user.password;
    }

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const oldPasswordHash = user.password;
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user.id,
      action: "Changed Password",
      target: user._id,
      details: {
        oldPasswordHash: oldPasswordHash.substring(0, 20) + '...',
        newPasswordHash: user.password.substring(0, 20) + '...'
      },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Changed Password",
      target: user._id,
      details: {}
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ================= SESSION MANAGEMENT =================

// Admin: view all sessions
exports.getAllSessions = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const sessions = await SessionLog.find()
      .populate('userId', 'firstName lastName email role')
      .sort({ loginAt: -1 });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Viewed All Sessions",
      target: null,
      details: {
        count: sessions.length
      }
    });

    res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions' });
  }
};

// Admin: view session by ID
exports.getSessionById = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const session = await SessionLog.findById(req.params.id)
      .populate('userId', 'firstName lastName email role');

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user._id,
      action: "Viewed Session",
      target: session._id,
      details: {
        sessionId: session._id,
        userId: session.userId
      }
    });

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch session' });
  }
};

// Terminate specific session
exports.terminateSession = async (req, res) => {
  try {
    const session = await SessionLog.findById(req.params.id);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Check if user owns the session or is admin
    if (session.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to terminate this session'
      });
    }

    session.logoutAt = new Date();
    await session.save();

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user.id,
      action: "Terminated Session",
      target: session._id,
      details: { sessionId: session._id, userId: session.userId },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Terminated Session",
      target: session._id,
      details: {
        sessionId: session._id,
        terminatedUserId: session.userId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Session terminated successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to terminate session'
    });
  }
};

// Logout from all sessions
exports.logoutAllSessions = async (req, res) => {
  try {
    const sessions = await SessionLog.find({
      userId: req.user.id,
      logoutAt: null
    });

    const logoutTime = new Date();
    await SessionLog.updateMany(
      { userId: req.user.id, logoutAt: null },
      { $set: { logoutAt: logoutTime } }
    );

    // ✅ AuditLog
    await AuditLog.create({
      userId: req.user.id,
      action: "Logged Out All Sessions",
      target: req.user.id,
      details: { terminatedSessions: sessions.length },
      ip: req.ip,
      device: req.headers['user-agent']
    });

    // ✅ Session activity
    await addSessionActivity({
      userId: req.user.id,
      action: "Logged Out All Sessions",
      target: req.user.id,
      details: {
        terminatedSessions: sessions.length
      }
    });

    res.status(200).json({
      success: true,
      message: `Logged out from ${sessions.length} sessions`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout from all sessions'
    });
  }
};