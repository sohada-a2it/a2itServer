const mongoose = require("mongoose");

const PayrollSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  basicPay: { type: Number, required: true },
  overtimePay: { type: Number, default: 0 },
  deductions: { type: Number, default: 0 },
  netPayable: { type: Number, required: true },
  status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },
  payslipPDF: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Payroll", PayrollSchema);
