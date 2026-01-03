// models/SessionLogModel.js - আপডেটেড
const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  target: {
    type: String
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const sessionLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // ✅ User details (denormalized for performance)
  userName: {
    type: String
  },
  userEmail: {
    type: String
  },
  userRole: {
    type: String
  },
  
  loginAt: {
    type: Date,
    default: Date.now
  },
  logoutAt: {
    type: Date
  },
  
  // ✅ Attendance fields
  clockIn: {
    type: Date
  },
  clockOut: {
    type: Date
  },
  totalHours: {
    type: Number,
    default: 0
  },
  
  ip: {
    type: String
  },
  device: {
    type: String
  },
  activities: [activitySchema],
  autoLogout: {
    type: Boolean,
    default: false
  },
  
  // ✅ Status field
  sessionStatus: {
    type: String,
    enum: ['active', 'logged_out', 'expired'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Indexes
sessionLogSchema.index({ userId: 1, logoutAt: 1 });
sessionLogSchema.index({ sessionStatus: 1 });

// Virtual for duration in minutes
sessionLogSchema.virtual('durationMinutes').get(function() {
  if (!this.loginAt) return 0;
  
  const endTime = this.logoutAt || new Date();
  const durationMs = endTime - this.loginAt;
  return Math.round(durationMs / (1000 * 60));
});

// Virtual for formatted duration
sessionLogSchema.virtual('formattedDuration').get(function() {
  const minutes = this.durationMinutes;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m`;
});

// Virtual for isActive
sessionLogSchema.virtual('isActive').get(function() {
  return !this.logoutAt && this.sessionStatus === 'active';
});

// Auto populate user info before save
sessionLogSchema.pre('save', async function(next) {
  // যদি user details না থাকে তবে populate করুন
  if (!this.userName || !this.userEmail) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.userId).select('firstName lastName email role');
      
      if (user) {
        this.userName = `${user.firstName} ${user.lastName}`;
        this.userEmail = user.email;
        this.userRole = user.role;
      }
    } catch (error) {
      console.error('Error populating user info:', error);
    }
  }
  next();
});

module.exports = mongoose.model('SessionLog', sessionLogSchema);