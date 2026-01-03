const mongoose = require('mongoose');

const salaryRuleSchema = new mongoose.Schema({
  title: { type: String, required: true },

  salaryType: {
    type: String,
    enum: ['Hourly', 'Monthly', 'Project'],
    required: true
  },

  rate: { type: Number, required: true }, // base salary / hour / project
  overtimeRate: { type: Number, default: 0 },
  bonus: { type: Number, default: 0 },

  // 🔽 Leave deduction rule
  leaveRule: {
    enabled: { type: Boolean, default: false },
    perDayDeduction: { type: Number, default: 0 } // 1 day leave = x taka
  },

  // 🔽 Late deduction rule
  lateRule: {
    enabled: { type: Boolean, default: false },
    lateDaysThreshold: { type: Number, default: 0 }, // e.g. 3 days
    equivalentLeaveDays: { type: Number, default: 0 } // e.g. 1 day salary cut
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true }

}, { timestamps: true });

module.exports = mongoose.model('SalaryRule', salaryRuleSchema);
