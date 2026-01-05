// utility/SendEmailUtility.js
const nodemailer = require("nodemailer");
require('dotenv').config();

const SendEmailUtility = async (EmailTo, EmailSubject, EmailText) => {
  try {
    console.log('📧 ===== EMAIL SENDING START =====');
    console.log('To:', EmailTo);
    console.log('From:', process.env.EMAIL_USER);
    console.log('Subject:', EmailSubject);
    
    // Gmail App Password configuration
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2', // 👈 Important: Use OAuth2
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    });

    // Or try this alternative configuration:
    const transporter2 = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    await transporter2.verify();
    console.log('✅ SMTP Connection verified!');

    // Email content
    const mailOptions = {
      from: `"A2IT HRM System" <${process.env.EMAIL_USER}>`,
      to: EmailTo,
      subject: EmailSubject,
      text: EmailText,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                     padding: 30px; color: white; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .otp-box { background: white; padding: 20px; text-align: center; margin: 20px 0; 
                      border-radius: 8px; border: 2px dashed #667eea; }
            .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #7c3aed; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
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
              <p>You have requested to reset password for:</p>
              <p><strong>User Email:</strong> ${EmailText.match(/for (.*?)\n/)?.[1] || 'N/A'}</p>
              
              <div class="otp-box">
                <p style="margin-bottom: 10px; color: #6b7280;">Your OTP Code is:</p>
                <div class="otp-code">${EmailText.match(/OTP Code: (\d{6})/)?.[1] || '000000'}</div>
                <p style="margin-top: 10px; color: #9ca3af; font-size: 14px;">
                  Valid for 10 minutes
                </p>
              </div>
              
              <p>If you didn't request this password reset, please ignore this email.</p>
              <p>For security reasons, do not share this OTP with anyone.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} A2IT HRM System. All rights reserved.</p>
              <p>This is an automated message, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    console.log('📤 Attempting to send email...');
    const info = await transporter2.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    console.log('📧 ===== EMAIL SENDING END =====');
    
    return info;
    
  } catch (error) {
    console.error('❌ EMAIL SENDING FAILED!');
    console.error('Error Details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      response: error.response
    });
    
    // If email fails, log to database or file
    console.log('💾 Logging email failure to console...');
    
    throw error;
  }
};

module.exports = SendEmailUtility;