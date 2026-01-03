const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    leaveType: {
      type: String,
      enum: ['Sick', 'Casual', 'Maternity', 'Paternity', 'Paid', 'Unpaid', 'HalfPaid', 'Bereavement', 'CompOff', 'Study', 'HalfDay'],
      default: 'Paid'
    },
    payStatus: {
      type: String,
      enum: ['Paid', 'Unpaid', 'HalfPaid'],
      default: 'Paid' // user choose or admin override
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending'
    },
    reason: { type: String },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

// Auto-calculate totalDays before save
leaveSchema.pre('save', function (next) {
  const diffTime = Math.abs(this.endDate - this.startDate);
  this.totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  next();
});

module.exports = mongoose.model('Leave', leaveSchema);
