const User = require('../models/UsersModel');
const bcrypt = require('bcrypt');
const OtpModel = require('../models/OtpModel');  
const sendEmail = require("../utility/SendEmailUtility");

// Admin email from environment
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // e.g., admin@a2it.com

// -------------------- Admin Request OTP --------------------
const AdminRequestOtp = async (req, res) => {
try {
    const { userEmail } = req.body;
    
    console.log('🔐 OTP REQUEST FOR:', userEmail);

    // 1. User check
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found"
      });
    }

    // 2. Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    console.log('🔢 OTP Generated:', otp);

    // 3. Save to DB
    await OtpModel.create({
      email: process.env.ADMIN_EMAIL || 'admin@a2it.com',
      otp,
      status: 0,
      userEmail,
      createdAt: new Date()
    });

    // 4. TRY TO SEND EMAIL
    let emailSent = false;
    let emailError = null;
    
    try {
      const emailSubject = `A2IT HRM - Password Reset OTP for ${userEmail}`;
      const emailText = `
Password Reset Request

User Email: ${userEmail}
OTP Code: ${otp}
Time: ${new Date().toLocaleString()}

This OTP is valid for 10 minutes.

If you didn't request this, please ignore this email.

Regards,
A2IT HRM System
      `;
      
      console.log('📧 Attempting email send to:', process.env.ADMIN_EMAIL);
      await sendEmail(process.env.ADMIN_EMAIL, emailSubject, emailText);
      emailSent = true;
      console.log('✅ Email sent successfully');
      
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError.message);
      // Continue even if email fails
    }

    // 5. ALWAYS RESPOND WITH OTP (for development/testing)
    const response = {
      status: "success",
      message: emailSent ? "OTP sent to admin email" : "OTP generated (email may not have been sent)",
      adminEmail: process.env.ADMIN_EMAIL,
      userEmail: userEmail,
      otp: otp, // 👈 Always include OTP in response for now
      emailSent: emailSent,
      timestamp: new Date().toISOString()
    };

    // In development, log OTP to console
    if (process.env.NODE_ENV === 'development') {
      console.log('='.repeat(60));
      console.log('🚨 DEVELOPMENT MODE - OTP NOT SENT VIA EMAIL');
      console.log('📧 Email would be sent to:', process.env.ADMIN_EMAIL);
      console.log('👤 User:', userEmail);
      console.log('🔢 OTP CODE:', otp);
      console.log('⏰ Generated at:', new Date().toLocaleTimeString());
      console.log('='.repeat(60));
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('💥 OTP Error:', error);
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// -------------------- Admin Verify OTP & Reset User Password --------------------
const AdminResetPassword = async (req, res) => {
  try {
    const { userEmail, otp, newPassword } = req.body;

    // Verify OTP exists and is unused
    const otpRecord = await OtpModel.findOne({ email: ADMIN_EMAIL, userEmail, otp, status: 0 });
    if (!otpRecord) {
      return res.status(400).json({ status: "fail", message: "Invalid OTP" });
    }

    // Mark OTP as used
    otpRecord.status = 1;
    await otpRecord.save();

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user's password
    await User.updateOne({ email: userEmail }, { password: hashedPassword });

    return res.status(200).json({
      status: "success",
      message: `Password for ${userEmail} reset successfully`
    });

  } catch (error) {
    console.error("❌ AdminResetPassword error:", error);
    return res.status(500).json({ status: "fail", message: error.message });
  }
};

// Export functions for routes
module.exports = {
  AdminRequestOtp,
  AdminResetPassword
};
