// models/AttendanceModel.js
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employee: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  date: { 
    type: Date, 
    required: true,
    index: true 
  },
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
  status: { 
    type: String, 
    enum: ['Present', 'Absent', 'Leave', 'Govt Holiday', 'Weekly Off', 'Off Day', 'Late', 'Clocked In', 'Half Day'], 
    default: 'Absent' 
  },
  
  // Shift Timing - Employee specific (can be overridden by admin)
  shiftTiming: {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '18:00' }
  },
  
  // For late calculation
  lateMinutes: {
    type: Number,
    default: 0
  },
  isLate: {
    type: Boolean,
    default: false
  },
  lateThreshold: {
    type: Number,
    default: 5 // 5 minutes
  },
  
  // Auto Clock Out
  autoClockOut: {
    type: Boolean,
    default: false
  },
  autoClockOutTime: {
    type: String,
    default: '18:10'
  },
  
  // Location and Device
  ipAddress: { 
    type: String 
  },
  device: { 
    type: Object 
  },
  location: {
    type: String
  },
  
  // Admin corrections
  correctedByAdmin: { 
    type: Boolean, 
    default: false 
  },
  correctedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  correctionDate: {
    type: Date
  },
  correctionReason: {
    type: String
  },
  
  // Admin adjusted shift timing
  adminAdjustedShift: {
    type: Boolean,
    default: false
  },
  adminShiftAdjustment: {
    start: String,
    end: String,
    adjustedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    adjustmentDate: Date,
    reason: String
  },
  
  // Other fields
  autoMarked: {
    type: Boolean,
    default: false
  },
  leaveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Leave'
  },
  overtimeHours: {
    type: Number,
    default: 0
  },
  earlyLeave: {
    type: Boolean,
    default: false
  },
  remarks: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});

// Indexes
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ employee: 1, status: 1 });
attendanceSchema.index({ isLate: 1 });
attendanceSchema.index({ autoClockOut: 1 });

module.exports = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);