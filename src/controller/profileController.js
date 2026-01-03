const User = require('../models/UsersModel');
const cloudinary = require('../services/Cloudinary');
const streamifier = require('streamifier');

// ================= UPLOAD PROFILE PICTURE =================
exports.uploadProfilePicture = async (req, res) => {
  try {
    console.log('📸 Upload profile picture request');

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // ✅ Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'Invalid image type' });
    }

    // ✅ Validate Cloudinary ENV (NO fallback)
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary environment variables missing'
      });
    }

    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 🧹 Delete old image if exists
    if (user.picture && user.picture.includes('res.cloudinary.com')) {
      const oldPublicId = user.picture
        .split('/upload/')[1]
        .split('.')[0];

      await cloudinary.uploader.destroy(oldPublicId);
      console.log('🗑️ Old Cloudinary image deleted');
    }

    // ☁️ Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'hrm-profile-pictures',
          public_id: `profile_${userId}_${Date.now()}`,
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );

      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      console.log("☁️ CLOUDINARY CHECK");
console.log("CLOUD_NAME:", process.env.CLOUDINARY_CLOUD_NAME);
console.log("API_KEY:", process.env.CLOUDINARY_API_KEY ? "OK" : "MISSING");
console.log("API_SECRET:", process.env.CLOUDINARY_API_SECRET ? "OK" : "MISSING");

    });

    // ✅ Save Cloudinary URL
    user.picture = uploadResult.secure_url;
    await user.save();

    console.log('✅ Cloudinary Upload Success:', uploadResult.secure_url);

    res.status(200).json({
      success: true,
      message: 'Profile picture uploaded successfully',
      pictureUrl: uploadResult.secure_url,
      user
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Cloudinary upload failed',
      error: error.message
    });
  }
};

// ================= REMOVE PROFILE PICTURE =================
exports.removeProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user || !user.picture) {
      return res.status(400).json({ success: false, message: 'No profile picture found' });
    }

    if (user.picture.includes('res.cloudinary.com')) {
      const publicId = user.picture
        .split('/upload/')[1]
        .split('.')[0];

      await cloudinary.uploader.destroy(publicId);
      console.log('🗑️ Cloudinary image deleted');
    }

    user.picture = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile picture removed',
      user
    });

  } catch (error) {
    console.error('❌ Remove error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove profile picture',
      error: error.message
    });
  }
};
