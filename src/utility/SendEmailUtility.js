// utility/SendEmailUtility.js - এইভাবে পরিবর্তন করুন
const nodemailer = require("nodemailer");
require('dotenv').config();

const SendEmailUtility = async (EmailTo, EmailSubject, EmailText) => {
  try {
    console.log('📧 ===== EMAIL SENDING START =====');
    console.log('To:', EmailTo);
    console.log('Subject:', EmailSubject);
    console.log('From User:', process.env.EMAIL_USER);
    console.log('Environment:', process.env.NODE_ENV);

    // Extract OTP from text
    const otpMatch = EmailText.match(/OTP Code: (\d{6})/);
    const otp = otpMatch ? otpMatch[1] : '000000';
    
    console.log('🔢 Extracted OTP:', otp);

    // SIMPLE Gmail SMTP Configuration (No OAuth2)
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
      },
      debug: true, // show debug logs
      logger: true // log to console
    });

    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    try {
      await transporter.verify();
      console.log('✅ SMTP Connection verified successfully!');
    } catch (verifyError) {
      console.error('❌ SMTP Verification failed:', verifyError.message);
      console.error('Error code:', verifyError.code);
      throw verifyError;
    }

    // HTML Email Template
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>A2IT HRM OTP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 30px;
        }
        .otp-container {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border: 2px solid #e9ecef;
        }
        .otp-code {
            font-size: 48px;
            font-weight: bold;
            color: #333;
            letter-spacing: 10px;
            margin: 20px 0;
            font-family: 'Courier New', monospace;
        }
        .info-box {
            background: #e8f4fd;
            border-radius: 6px;
            padding: 15px;
            margin: 15px 0;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 12px;
            border-top: 1px solid #eee;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 A2IT HRM System</h1>
            <p>Password Reset OTP Verification</p>
        </div>
        <div class="content">
            <h2>Hello Admin,</h2>
            <p>You have requested to reset password for a user account.</p>
            
            <div class="info-box">
                <p><strong>User Email:</strong> ${EmailText.match(/User Email: (.*?)\n/)?.[1] || 'N/A'}</p>
                <p><strong>Request Time:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div class="otp-container">
                <p style="color: #666; margin-bottom: 10px;">Your One-Time Password (OTP) is:</p>
                <div class="otp-code">${otp}</div>
                <p style="color: #888; font-size: 14px; margin-top: 10px;">
                    Valid for 10 minutes
                </p>
            </div>
            
            <p style="color: #ff6b6b; font-weight: bold;">
                ⚠️ Security Notice: Do not share this OTP with anyone.
            </p>
            
            <p>If you didn't request this password reset, please ignore this email.</p>
            
            <p>Best regards,<br>
            <strong>A2IT HRM System Team</strong></p>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} A2IT HRM. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
        </div>
    </div>
</body>
</html>
    `;

    // Prepare email
    const mailOptions = {
      from: `"A2IT HRM System" <${process.env.EMAIL_USER}>`,
      to: EmailTo,
      subject: EmailSubject,
      text: EmailText,
      html: htmlContent,
      priority: 'high'
    };

    console.log('📤 Sending email...');
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ EMAIL SENT SUCCESSFULLY!');
    console.log('📫 Message ID:', info.messageId);
    console.log('👁️ Preview URL:', nodemailer.getTestMessageUrl(info));
    console.log('📧 ===== EMAIL SENDING END =====');
    
    return info;
    
  } catch (error) {
    console.error('❌❌❌ EMAIL SENDING FAILED! ❌❌❌');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Code:', error.code);
    
    // More specific error handling
    if (error.code === 'EAUTH') {
      console.error('❌ Authentication failed. Check email/password.');
      console.error('Make sure to use App Password, not regular password.');
    } else if (error.code === 'ECONNECTION') {
      console.error('❌ Connection failed. Check internet/port.');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('❌ Connection timeout. Gmail might be blocking.');
    }
    
    throw error;
  }
};

module.exports = SendEmailUtility;