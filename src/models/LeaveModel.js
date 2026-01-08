const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  leaveType: {
    type: String,
    enum: ['Sick', 'Annual', 'Casual', 'Emergency', 'Maternity', 'Paternity', 'Other'],
    required: true
  },
  payStatus: {
    type: String,
    enum: ['Paid', 'Unpaid', 'HalfPaid'],
    required: true,
    default: 'Paid'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  totalDays: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: Date,
  rejectionReason: String,
  requestedAt: {
    type: Date,
    default: Date.now
  },
    // Shift timing per employee
  shiftTiming: {
    start: { type: String, default: '09:00' }, // Default 9 AM
    end: { type: String, default: '18:00' }     // Default 6 PM
  },
  
  // Late calculation settings
  lateSettings: {
    thresholdMinutes: { type: Number, default: 5 }, // 5 minutes
    gracePeriod: { type: Number, default: 0 }, // 0 minutes grace
    calculateFromShiftStart: { type: Boolean, default: true }
  },
  
  // Auto clock out settings
  autoClockOutSettings: {
    enabled: { type: Boolean, default: true },
    time: { type: String, default: '18:10' }, // 6:10 PM
    overrideDefault: { type: Boolean, default: false }
  },
}, {
  timestamps: true
});

// Indexes for better performance
leaveSchema.index({ employee: 1, status: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });
leaveSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Leave', leaveSchema);