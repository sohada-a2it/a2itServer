// seedAdmin.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const User = require("../models/UsersModel");

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected ✅");

    const adminData = {
      firstName: "Super",
      lastName: "Admin",
      email: "founder@a2itltd.com",
      password: "Admin123",
      role: "admin",
      
      isActive: true,
      status: "active",
      
      department: "Administration",
      designation: "System Administrator",
      phone: "01700000000",
      employeeId: "", // Admin এর জন্য empty
      
      salaryType: "monthly",
      rate: 0,
      salary: 0,
      basicSalary: 0,
      joiningDate: new Date(),
      
      picture: "https://example.com/default-avatar.png",
      address: "Dhaka, Bangladesh",
      
      // Admin-specific fields
      adminLevel: "super",
      companyName: "Your Company Ltd.",
      adminPosition: "Chief Administrator",
      permissions: [
        "user:read", 
        "user:create", 
        "user:update", 
        "user:delete",
        "payroll:manage",
        "settings:manage",
        "reports:view"
      ],
      isSuperAdmin: true,
      canManageUsers: true,
      canManagePayroll: true
    };

    let admin = await User.findOne({ email: adminData.email });

    if (admin) {
      console.log("⚠️ Admin already exists. Updating info...");
      Object.assign(admin, adminData);
      await admin.save();
      console.log("✅ Admin updated successfully!");
    } else {
      console.log("Creating new admin...");
      admin = await User.create(adminData);
      console.log("✅ Admin created successfully!");
    }

    console.log("\n=== Verification ===");
    console.log("Name:", admin.firstName + " " + admin.lastName);
    console.log("Email:", admin.email);
    console.log("Role:", admin.role);
    console.log("Admin Level:", admin.adminLevel);
    console.log("Company:", admin.companyName);
    
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error seeding admin:", err.message);
    process.exit(1);
  }
};

seedAdmin();