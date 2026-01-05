const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // ============ COMMON FIELDS (Employee & Admin) ============
    // Personal Info
    firstName: { 
      type: String, 
      required: [true, 'First name is required'],
      trim: true
    },
    lastName: { 
      type: String, 
      required: [true, 'Last name is required'],
      trim: true
    },
    email: { 
      type: String, 
      required: [true, 'Email is required'], 
      unique: true, 
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: { 
      type: String, 
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters']
    },

    // Role & Status
    role: { 
      type: String, 
      enum: ["admin", "employee"],  
      default: "employee",
      required: true
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'suspended'],
      default: 'active' 
    },

    // Professional Info
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    phone: { type: String, default: '' },
    employeeId: { type: String, default: '' },

    // Salary Info (Employee-specific, কিন্তু Admin-ও হতে পারে)
    salaryType: { 
      type: String, 
      enum: ['hourly', 'monthly', 'project', 'yearly', 'commission', 'fixed'],
      default: 'monthly'
    },
    rate: { 
      type: Number,  
      min: 0,
      default: 0
    },
    salary: {  // ✅ salary ফিল্ড যোগ করুন (আপনার original থেকে)
      type: Number,
      default: 0
    },
    basicSalary: { // নতুন field
      type: Number,
      min: 0,
      default: 0
    },
    joiningDate: { 
      type: Date,
      default: Date.now
    },

    // Profile Picture
    picture: { 
      type: String,
      default: '' 
    },
    address: {
      type: String,
      default: ''
    },

    // Salary Rule (আপনার original থেকে রাখা)
    salaryRule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalaryRule',
      default: null
    },

    // ============ ADMIN-SPECIFIC FIELDS ============
    // এগুলো শুধু Admin এর জন্য populate হবে
    adminLevel: {
      type: String,
      enum: ['super', 'admin', 'manager', 'moderator'],
      default: 'admin',
      required: function() {
        return this.role === 'admin'; // শুধু admin হলে required
      }
    },
    companyName: {
      type: String,
      default: '',
      required: function() {
        return this.role === 'admin';
      }
    },
    adminPosition: {
      type: String,
      default: 'Administrator',
      required: function() {
        return this.role === 'admin';
      }
    },
    permissions: {
      type: [String], // Array of permissions
      default: function() {
        // Role-based default permissions
        if (this.role === 'admin') {
          return ['user:read', 'user:create', 'user:update'];
        }
        return [];
      }
    },
    isSuperAdmin: {
      type: Boolean,
      default: false
    },
    canManageUsers: {
      type: Boolean,
      default: function() {
        return this.role === 'admin';
      }
    },
    canManagePayroll: {
      type: Boolean,
      default: function() {
        return this.role === 'admin';
      }
    },

    // ============ EMPLOYEE-SPECIFIC FIELDS ============
    // এগুলো শুধু Employee এর জন্য
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      required: function() {
        return this.role === 'employee';
      }
    },
    attendanceId: {
      type: String,
      default: ''
    },
    shiftTiming: {
      start: { type: String, default: '09:00' },
      end: { type: String, default: '18:00' }
    }
  },
  { 
    timestamps: true,
    // Optional: আপনি চাইলে toJSON transform add করতে পারেন
    toJSON: { 
      transform: function(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// ✅ **সঠিক Password Hashing (আগের model থেকে)**
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);  // এই line টি crucial
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ✅ **সঠিক Password Comparison (আগের model থেকে)**
userSchema.methods.matchPassword = async function (password) {
  return await bcrypt.compare(password, this.password);  // await টি important
};

// Optional: Basic virtuals (নতুন model থেকে)
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// ✅ Role-based validation
userSchema.pre('save', function(next) {
  // Admin validation
  if (this.role === 'admin') {
    if (!this.adminLevel) {
      this.adminLevel = 'admin';
    }
    if (!this.permissions || this.permissions.length === 0) {
      this.permissions = ['user:read', 'user:create', 'user:update'];
    }
    // Admin এর জন্য employeeId থাকবে না বা empty রাখুন
    if (!this.employeeId) {
      this.employeeId = '';
    }
  }
  
  // Employee validation
  if (this.role === 'employee') {
    if (!this.employeeId) {
      // Generate employee ID
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      this.employeeId = `EMP-${timestamp}${random}`;
    }
    
    // Employee এর জন্য admin specific fields clear করুন
    this.adminLevel = undefined;
    this.companyName = undefined;
    this.adminPosition = undefined;
    this.isSuperAdmin = undefined;
    this.canManageUsers = undefined;
    this.canManagePayroll = undefined;
  }
  
  // Salary calculation যদি rate দেয়া থাকে
  if (this.salaryType === 'monthly' && this.rate > 0 && this.salary === 0) {
    this.salary = this.rate;
    this.basicSalary = this.rate;
  }
  
  next();
});

// ✅ Static method to get role-based fields
userSchema.statics.getRoleFields = function(role) {
  const commonFields = [
    'firstName', 'lastName', 'email', 'password',
    'role', 'isActive', 'status', 'department',
    'designation', 'phone', 'picture', 'address',
    'salaryType', 'rate', 'salary', 'basicSalary',
    'joiningDate', 'salaryRule'
  ];
  
  if (role === 'admin') {
    return [
      ...commonFields,
      'adminLevel', 'companyName', 'adminPosition',
      'permissions', 'isSuperAdmin', 'canManageUsers',
      'canManagePayroll'
    ];
  } else {
    return [
      ...commonFields,
      'employeeId', 'managerId', 'attendanceId', 'shiftTiming'
    ];
  }
};

// ✅ Method to check if user is admin
userSchema.methods.isAdmin = function() {
  return this.role === 'admin';
};

// ✅ Method to check if user is employee
userSchema.methods.isEmployee = function() {
  return this.role === 'employee';
};

// ✅ Method to check if user has permission
userSchema.methods.hasPermission = function(permission) {
  if (this.role !== 'admin') return false;
  if (this.isSuperAdmin) return true;
  return this.permissions && this.permissions.includes(permission);
};

module.exports = mongoose.model("User", userSchema);