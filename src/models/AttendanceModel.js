const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  clockIn: { type: Date },
  clockOut: { type: Date },
  totalHours: { type: Number, default: 0 },
  status: { type: String, enum: ['Present', 'Absent', 'Leave', 'Govt Holiday', 'Weekly Off'], default: 'Absent' },
  ipAddress: { type: String },
  device: { type: Object },
  correctedByAdmin: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
