const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
{
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },

  role: { type: String, enum: ["admin","employee"], default: "employee" },
  isActive: { type: Boolean, default: true },
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'suspended'], 
    default: 'active' 
  },

  department: { type: String, default: '' },
  designation: { type: String, default: '' },
  phone: { type: String, default: '' },
  employeeId: { type: String, default: '' },

  // 🔹 Salary Info
  salaryType: { 
    type: String, 
    enum: ['hourly', 'monthly', 'project'], 
  },
  rate: { 
    type: Number,  
    min: 0 
  },
  joiningDate: { 
    type: Date,  
  },

  // 🖼️ Profile Picture
  picture: { 
    type: String,   // image URL or file path
    default: '' 
  }
}
,
  { timestamps: true }
);

// password hash
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// password match
userSchema.methods.matchPassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
 