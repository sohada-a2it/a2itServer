// AttendanceModel.js - new version
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employee: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  date: { 
    type: Date, 
    required: true 
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
  
  // Status with more detailed options
  status: { 
    type: String, 
    enum: ['Present', 'Absent', 'Leave', 'Govt Holiday', 'Weekly Off', 'Off Day', 'Late', 'Half Day', 'Clocked In', 'Auto Clocked In'], 
    default: 'Absent' 
  },
  
  // Detailed tracking for payroll
  payrollMetrics: {
    // Auto-calculated daily salary
    dailyEarnings: {
      type: Number,
      default: 0
    },
    
    // Overtime details
    overtimeHours: {
      type: Number,
      default: 0
    },
    overtimeAmount: {
      type: Number,
      default: 0
    },
    
    // Late details
    lateMinutes: {
      type: Number,
      default: 0
    },
    lateDeduction: {
      type: Number,
      default: 0
    },
    
    // Deductions
    absentDeduction: {
      type: Number,
      default: 0
    },
    halfDayDeduction: {
      type: Number,
      default: 0
    },
    
    // Total for the day
    netDailyAmount: {
      type: Number,
      default: 0
    },
    
    // Payroll reference
    payrollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payroll'
    },
    
    // Calculation timestamp
    calculatedAt: {
      type: Date
    },
    calculatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  ipAddress: { 
    type: String 
  },
  device: { 
    type: Object 
  },
  location: {
    type: String
  },
  
  // Auto-marking
  autoMarked: { 
    type: Boolean, 
    default: false 
  },
  autoClockOut: {
    type: Boolean,
    default: false
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
  
  leaveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Leave'
  }
}, { 
  timestamps: true 
});

// Compound index for faster queries
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
// Index for payroll calculations
attendanceSchema.index({ 'payrollMetrics.payrollId': 1 });
attendanceSchema.index({ date: 1, status: 1 });

// Method to calculate payroll metrics for this attendance
attendanceSchema.methods.calculatePayrollMetrics = async function(employee) {
  const dailyRate = (employee.salaryStructure?.basicSalary || 0) / 26;
  const hourlyRate = dailyRate / 8;
  
  let dailyEarnings = 0;
  let overtimeHours = 0;
  let overtimeAmount = 0;
  let lateDeduction = 0;
  let absentDeduction = 0;
  let halfDayDeduction = 0;
  
  switch(this.status) {
    case 'Present':
    case 'Clocked In':
      dailyEarnings = dailyRate;
      
      // Overtime calculation
      if (this.totalHours > 8) {
        overtimeHours = this.totalHours - 8;
        overtimeAmount = overtimeHours * (hourlyRate * 1.5); // 1.5x for overtime
      }
      break;
      
    case 'Late':
      dailyEarnings = dailyRate;
      lateDeduction = dailyRate * 0.1; // 10% deduction for being late
      
      // Overtime calculation
      if (this.totalHours > 8) {
        overtimeHours = this.totalHours - 8;
        overtimeAmount = overtimeHours * (hourlyRate * 1.5);
      }
      break;
      
    case 'Half Day':
      dailyEarnings = dailyRate * 0.5;
      halfDayDeduction = dailyRate * 0.5;
      break;
      
    case 'Absent':
      absentDeduction = dailyRate;
      break;
      
    case 'Leave':
      // Paid leave - no deduction
      dailyEarnings = dailyRate;
      break;
      
    default:
      // Holiday, Weekly Off - no earnings/deductions
      break;
  }
  
  // Calculate late minutes if clocked in after 10:00 AM
  if (this.clockIn) {
    const clockInHour = this.clockIn.getHours();
    const clockInMinute = this.clockIn.getMinutes();
    const totalMinutes = (clockInHour * 60) + clockInMinute;
    const lateThreshold = 10 * 60; // 10:00 AM
    
    if (totalMinutes > lateThreshold) {
      this.payrollMetrics.lateMinutes = totalMinutes - lateThreshold;
    }
  }
  
  // Update payroll metrics
  this.payrollMetrics = {
    dailyEarnings,
    overtimeHours,
    overtimeAmount,
    lateMinutes: this.payrollMetrics.lateMinutes || 0,
    lateDeduction,
    absentDeduction,
    halfDayDeduction,
    netDailyAmount: dailyEarnings + overtimeAmount - lateDeduction - absentDeduction - halfDayDeduction,
    calculatedAt: new Date()
  };
  
  return this.payrollMetrics;
};

module.exports = mongoose.model('Attendance', attendanceSchema);