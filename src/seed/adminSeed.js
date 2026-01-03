// seedAdmin.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

// Import User model
const User = require("../models/UsersModel");

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected ✅");
    console.log("Database:", mongoose.connection.name);
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

const seedAdmin = async () => {
  try {
    console.log("\n=== Seeding Admin User ===");

    // Admin data
const adminData = {
  firstName: "Super",
  lastName: "Admin",
  email: "a2itsohada@gmail.com",
  password: "Admin123",
  role: "admin",

  // Status
  isActive: true,
  status: "active",

  // Organization
  department: "Administration",
  designation: "System Admin",
  joiningDate: new Date(), // today

  // Contact
  phone: "01700000000",
  AdminId: "ADMIN-" + Date.now(),

  // Profile
  picture: "https://example.com/default-avatar.png",
  address: "Dhaka, Bangladesh",

  // Permissions
  isSuperAdmin: true,
  permissions: ["manage_users", "view_reports"],
};



    // Check if admin already exists
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

    // Verification
    console.log("\n=== Verification ===");
    console.log("Name:", admin.firstName + " " + admin.lastName);
    console.log("Email:", admin.email);
    console.log("Role:", admin.role);
    console.log("ID:", admin.AdminId);

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error seeding admin:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
};

// Run seeding after connection is ready
mongoose.connection.once("open", () => {
  seedAdmin();
});
