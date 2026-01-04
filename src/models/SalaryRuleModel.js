// models/SalaryRuleModel.js
const mongoose = require('mongoose');

const salaryRuleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true
  },
  description: {
    type: String, 
    trim: true
  },
  ruleType: {
    type: String,
    enum: ['late_deduction', 'adjustment_deduction', 'bonus', 'allowance'],
    default: 'late_deduction'
  },
  calculation: {
    type: String,
    default: ''
  },
  deductionAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  conditions: {
    threshold: {
      type: Number,
      default: 1,
      min: 0
    },
    deductionType: {
      type: String,
      enum: ['daily_salary', 'percentage', 'fixed_amount'],
      default: 'daily_salary'
    },
    applicableTo: [{
      type: String,
      default: ['all_employees']
    }],
    effectiveFrom: {
      type: Date,
      default: Date.now
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isSystemDefault: {
    type: Boolean,
    default: false
  },
  ruleCode: {
    type: String,
    unique: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
salaryRuleSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const SalaryRule = mongoose.model('SalaryRule', salaryRuleSchema);
module.exports = SalaryRule;