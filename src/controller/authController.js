const User = require('../models/UsersModel');
const bcrypt = require('bcrypt');
const OtpModel = require('../models/OtpModel');  
const sendEmail = require("../utility/SendEmailUtility");

// Admin email from environment
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // example: admin@a2it.com

// -------------------- Admin Request OTP --------------------
exports.AdminRequestOtp = async (req, res) => {
    try {
        const { userEmail } = req.body; // The user whose password admin wants to reset
        const user = await User.findOne({ email: userEmail });

        if (!user) {
            return res.status(404).json({ status: "fail", message: "User not found" });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000);

        // Save OTP in DB linked to admin email
        await OtpModel.create({ email: ADMIN_EMAIL, otp, status: 0, userEmail });

        // Send OTP to admin only
        await sendEmail(ADMIN_EMAIL, "A2IT Admin Password Reset OTP", `OTP to reset password for ${userEmail} is ${otp}`);

        res.status(200).json({ status: "success", message: "OTP sent to admin email" });

    } catch (error) {
        res.status(500).json({ status: "fail", message: error.message });
    }
};

// -------------------- Admin Verify OTP & Reset User Password --------------------
exports.AdminResetPassword = async (req, res) => {
    try {
        const { userEmail, otp, newPassword } = req.body;

        // Verify OTP for admin and the specific user
        const otpRecord = await OtpModel.findOne({ email: ADMIN_EMAIL, otp, status: 0, userEmail });
        if (!otpRecord) {
            return res.status(400).json({ status: "fail", message: "Invalid OTP" });
        }

        // Mark OTP as used
        otpRecord.status = 1;
        await otpRecord.save();

        // Hash the new password and update user's password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ email: userEmail }, { password: hashedPassword });

        res.status(200).json({ status: "success", message: `Password for ${userEmail} reset successfully` });

    } catch (error) {
        res.status(500).json({ status: "fail", message: error.message });
    }
};