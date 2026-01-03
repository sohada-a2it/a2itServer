const cloudinary = require('../services/Cloudinary');
const User = require('../models/UsersModel'); 

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
  try {
    // req.user থেকে userType এবং userId নিন
    const userType = req.user?.role || req.user?.userType; // 'admin' or 'employee'
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID not found' 
      });
    }
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: `profile-pictures/${userType}s`,
      public_id: `${userType}_${userId}_${Date.now()}`,
      width: 500,
      height: 500,
      crop: 'fill',
      gravity: 'face',
      quality: 'auto',
      format: 'webp'
    });

    // Save to database - শুধু User model ব্যবহার করুন
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        picture: uploadResult.secure_url,
        picturePublicId: uploadResult.public_id
      },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      pictureUrl: uploadResult.secure_url,
      picture: uploadResult.secure_url,
      user: updatedUser
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload profile picture',
      error: error.message 
    });
  }
};

// Remove profile picture
exports.removeProfilePicture = async (req, res) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID not found' 
      });
    }

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (user.picturePublicId) {
      // Delete from Cloudinary
      await cloudinary.uploader.destroy(user.picturePublicId);
    }

    // Remove from database
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $unset: { picture: '', picturePublicId: '' }
      },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile picture removed successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Remove error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove profile picture',
      error: error.message 
    });
  }
};