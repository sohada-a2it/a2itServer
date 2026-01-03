const Payroll = require('../models/PayrollModel');  
const User = require('../models/UsersModel');

// -------------------- Create Payroll -------------------- 

exports.createPayroll = async (req, res) => {
  try {
    const {
      employee,
      periodStart,
      periodEnd,
      basicPay,
      overtimePay = 0,
      deductions = 0,
      netPayable,
      status
    } = req.body;

    // Employee details fetch
    const employeeData = await User.findById(employee);
    if (!employeeData) {
      return res.status(404).json({ 
        status: "fail", 
        message: "Employee not found" 
      });
    }

    // Build full name from firstName + lastName
    const employeeName = `${employeeData.firstName || ''} ${employeeData.lastName || ''}`.trim();

    // Automatically calculate netPayable if not provided
    const calculatedNetPayable = netPayable ?? (basicPay + overtimePay - deductions);

    // Create payroll
    const payroll = new Payroll({
      employee,
      name: employeeName,  // ✅ Fixed
      periodStart,
      periodEnd,
      basicPay,
      overtimePay,
      deductions,
      netPayable: calculatedNetPayable,
      status: status || 'Pending'
    });

    await payroll.save();

    res.status(201).json({
      status: "success",
      message: "Payroll created successfully",
      data: payroll
    });

  } catch (error) {
    res.status(500).json({ 
      status: "fail", 
      message: error.message 
    });
  }
};




// -------------------- Get All Payrolls --------------------
exports.getAllPayrolls = async (req, res) => {
  try {
    const payrolls = await Payroll.find()
      .populate(
        'employee',
        'firstName lastName email employeeId role'
      );

    res.status(200).json({
      status: "success",
      payrolls
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};


// -------------------- Get Payroll by ID --------------------
exports.getPayrollById = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id).populate('employee', 'name email');
        if (!payroll) {
            return res.status(404).json({ status: "fail", message: "Payroll not found" });
        }
        res.status(200).json({ status: "success", payroll });
    } catch (error) {
        res.status(500).json({ status: "fail", message: error.message });
    }
};

// -------------------- Update Payroll --------------------
exports.updatePayroll = async (req, res) => {
    try {
        const { basicPay, overtimePay, deductions, status } = req.body;

        const payroll = await Payroll.findById(req.params.id);
        if (!payroll) {
            return res.status(404).json({ status: "fail", message: "Payroll not found" });
        }

        if (basicPay !== undefined) payroll.basicPay = basicPay;
        if (overtimePay !== undefined) payroll.overtimePay = overtimePay;
        if (deductions !== undefined) payroll.deductions = deductions;
        if (status) payroll.status = status;

        // recalculate netPayable
        payroll.netPayable = payroll.basicPay + payroll.overtimePay - payroll.deductions;

        await payroll.save();

        res.status(200).json({ status: "success", message: "Payroll updated", payroll });
    } catch (error) {
        res.status(500).json({ status: "fail", message: error.message });
    }
};

// -------------------- Delete Payroll --------------------
exports.deletePayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findByIdAndDelete(req.params.id);
        if (!payroll) {
            return res.status(404).json({ status: "fail", message: "Payroll not found" });
        }
        res.status(200).json({ status: "success", message: "Payroll deleted successfully" });
    } catch (error) {
        res.status(500).json({ status: "fail", message: error.message });
    }
};
