const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
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

    role: { 
      type: String, 
      enum: ["admin", "employee", "manager"], 
      default: "employee" 
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'suspended', 'on-leave'], 
      default: 'active' 
    },

    department: { 
      type: String, 
      default: '' 
    },
    designation: { 
      type: String, 
      default: '' 
    },
    phone: { 
      type: String, 
      default: '',
      trim: true
    },
    employeeId: { 
      type: String, 
      unique: true,
      sparse: true,
      trim: true
    },

    // 🔹 Salary Info
    salaryType: { 
      type: String, 
      enum: ['hourly', 'monthly', 'weekly', 'project', 'daily'], 
      default: 'monthly'
    },
    rate: { 
      type: Number,  
      min: 0,
      default: 0
    },
    salary: {
      type: Number,
      default: 0,
      min: 0
    },
    joiningDate: { 
      type: Date,
      default: Date.now
    },

    // 🔹 Leave Management (Fixed - was incorrectly placed)
    leaveDays: [{
      date: Date,
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected']
      },
      leaveType: String,
      leaveId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Leave'
      }
    }],

    // 🔹 Salary Rule Reference
    salaryRule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalaryRule'
    },

    // 🖼️ Profile Picture
    picture: { 
      type: String,
      default: 'https://res.cloudinary.com/demo/image/upload/v1586166987/avatar.png'
    },

    // 🔹 Additional fields for your controllers
    lastLogin: {
      type: Date
    },
    
    loginCount: {
      type: Number,
      default: 0
    },
    
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    
    // For soft delete
    isDeleted: {
      type: Boolean,
      default: false,
      select: false
    },
    
    deletedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: { 
      virtuals: true,
      transform: function(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for employment status
userSchema.virtual('isEmployed').get(function() {
  return this.status === 'active' && this.isActive && !this.isDeleted;
});

// Password hash middleware
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Password match method
userSchema.methods.matchPassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Update last login method
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  this.loginCount += 1;
  return this.save();
};

// Soft delete method
userSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.status = 'inactive';
  this.isActive = false;
  return this.save();
};

// Restore method
userSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.status = 'active';
  this.isActive = true;
  return this.save();
};

// Exclude deleted users by default
userSchema.pre(/^find/, function(next) {
  if (!this.options.withDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

// Indexes for better performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ employeeId: 1 }, { unique: true, sparse: true });
userSchema.index({ department: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);