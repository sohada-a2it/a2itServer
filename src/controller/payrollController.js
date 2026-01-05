const Payroll = require('../models/PayrollModel');  
const User = require('../models/UsersModel');
const Attendance = require('../models/AttendanceModel');
const Leave = require('../models/LeaveModel');
const SalaryRule = require('../models/SalaryRuleModel');

// -------------------- Calculate Salary Automatically --------------------
const calculateSalary = async (employeeId, periodStart, periodEnd) => {
  try {
    // Fetch employee with salary details
    const employee = await User.findById(employeeId)
      .populate('salaryRule')
      .populate('manager', 'firstName lastName');
    
    if (!employee) {
      throw new Error('Employee not found');
    }

    // Get default salary rule if employee doesn't have specific rule
    let salaryRule;
    if (employee.salaryRule) {
      salaryRule = employee.salaryRule;
    } else {
      salaryRule = await SalaryRule.findOne({ isActive: true }).sort({ createdAt: -1 });
    }

    if (!salaryRule) {
      throw new Error('Salary rules not configured');
    }

    // Extract rules from salaryRule model (Updated structure)
    const rules = salaryRule.toObject();
    const workingDaysPerMonth = salaryRule.workingDaysPerMonth || 26;
    const perDaySalaryCalculation = salaryRule.perDaySalaryCalculation !== false; // Default true

    // Calculate employee's monthly salary
    let monthlyBasic = 0;
    
    if (employee.salary > 0) {
      // If salary field exists in user model
      monthlyBasic = employee.salary;
    } else if (employee.rate > 0) {
      // Calculate based on rate and salaryType
      switch(employee.salaryType) {
        case 'hourly':
          // Default: 8 hours/day, workingDaysPerMonth days/month
          monthlyBasic = employee.rate * 8 * workingDaysPerMonth;
          break;
        case 'daily':
          monthlyBasic = employee.rate * workingDaysPerMonth;
          break;
        case 'weekly':
          monthlyBasic = employee.rate * 4; // 4 weeks per month
          break;
        case 'monthly':
          monthlyBasic = employee.rate;
          break;
        case 'project':
          // For project-based, use the rate as fixed monthly
          monthlyBasic = employee.rate;
          break;
        default:
          monthlyBasic = employee.rate || 0;
      }
    } else {
      // Use salary rule's default rate
      monthlyBasic = salaryRule.rate || 0;
    }

    // Calculate attendance for the period
    const attendanceRecords = await Attendance.find({
      employee: employeeId,
      date: { 
        $gte: new Date(periodStart), 
        $lte: new Date(periodEnd) 
      }
    });

    // Count different attendance statuses
    const presentDays = attendanceRecords.filter(record => 
      ['Present', 'Clocked In', 'Late'].includes(record.status)
    ).length;
    
    const absentDays = attendanceRecords.filter(record => 
      record.status === 'Absent'
    ).length;
    
    const lateDays = attendanceRecords.filter(record => 
      record.status === 'Late'
    ).length;
    
    const leaveRecords = attendanceRecords.filter(record => 
      record.status === 'Leave'
    ).length;

    const attendancePercentage = workingDaysPerMonth > 0 
      ? (presentDays / workingDaysPerMonth) * 100 
      : 0;

    // Calculate approved leave days for the period from Leave model
    const approvedLeaves = await Leave.find({
      employee: employeeId,
      status: 'Approved',
      $or: [
        { startDate: { $lte: periodEnd, $gte: periodStart } },
        { endDate: { $lte: periodEnd, $gte: periodStart } },
        { 
          startDate: { $lte: periodStart },
          endDate: { $gte: periodEnd }
        }
      ]
    });

    let totalLeaveDays = 0;
    approvedLeaves.forEach(leave => {
      const start = new Date(Math.max(new Date(leave.startDate), new Date(periodStart)));
      const end = new Date(Math.min(new Date(leave.endDate), new Date(periodEnd)));
      const diffTime = Math.abs(end - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      totalLeaveDays += diffDays;
    });

    // Calculate basic pay based on attendance
    let calculatedBasic = monthlyBasic;
    
    if (perDaySalaryCalculation && workingDaysPerMonth > 0) {
      calculatedBasic = (monthlyBasic / workingDaysPerMonth) * presentDays;
    }

    // Calculate all components based on salary rule structure
    const components = {};
    let totalAddition = 0;
    let totalDeduction = 0;

    // Handle different salary rule structures
    if (salaryRule.components && Array.isArray(salaryRule.components)) {
      salaryRule.components.forEach(component => {
        let amount = 0;
        
        if (component.type === 'percentage') {
          amount = (calculatedBasic * component.value) / 100;
        } else if (component.type === 'fixed') {
          amount = component.value;
        } else if (component.type === 'attendance_based') {
          // Example: Bonus based on attendance percentage
          if (component.condition === 'attendance_above_95' && attendancePercentage >= 95) {
            amount = component.value;
          }
        }
        
        components[component.name] = amount;
        
        if (component.category === 'addition') {
          totalAddition += amount;
        } else if (component.category === 'deduction') {
          totalDeduction += amount;
        }
      });
    }

    // Calculate overtime if enabled
    let overtimeAmount = 0;
    if (salaryRule.overtimeEnabled && salaryRule.overtimeRate) {
      // Calculate overtime hours from attendance records
      let totalOvertimeHours = 0;
      
      attendanceRecords.forEach(record => {
        if (record.totalHours > 8) { // Assuming 8 hours is standard work day
          totalOvertimeHours += (record.totalHours - 8);
        }
      });
      
      overtimeAmount = totalOvertimeHours * salaryRule.overtimeRate;
      totalAddition += overtimeAmount;
      components['Overtime'] = overtimeAmount;
    }

    // Calculate leave deductions if enabled
    let leaveDeduction = 0;
    if (salaryRule.leaveRule && salaryRule.leaveRule.enabled) {
      const paidLeaves = salaryRule.leaveRule.paidLeaves || 0;
      const perDayDeduction = salaryRule.leaveRule.perDayDeduction || 0;
      
      if (totalLeaveDays > paidLeaves) {
        const extraLeaves = totalLeaveDays - paidLeaves;
        leaveDeduction = extraLeaves * perDayDeduction;
        totalDeduction += leaveDeduction;
        components['Leave Deduction'] = leaveDeduction;
      }
    }

    // Calculate late deductions if enabled
    let lateDeduction = 0;
    if (salaryRule.lateRule && salaryRule.lateRule.enabled) {
      const lateThreshold = salaryRule.lateRule.lateDaysThreshold || 3;
      const equivalentLeaveDays = salaryRule.lateRule.equivalentLeaveDays || 0.5;
      const perDaySalary = monthlyBasic / workingDaysPerMonth;
      
      if (lateDays > lateThreshold) {
        const extraLateDays = lateDays - lateThreshold;
        const equivalentLeaveCount = extraLateDays * equivalentLeaveDays;
        lateDeduction = equivalentLeaveCount * perDaySalary;
        totalDeduction += lateDeduction;
        components['Late Deduction'] = lateDeduction;
      }
    }

    // Add bonus if conditions met
    let bonusAmount = 0;
    if (salaryRule.bonusAmount && salaryRule.bonusConditions) {
      // Example: Check bonus conditions
      const conditions = salaryRule.bonusConditions.toLowerCase();
      let bonusEligible = true;
      
      if (conditions.includes('attendance_above_90') && attendancePercentage < 90) {
        bonusEligible = false;
      }
      if (conditions.includes('no_late') && lateDays > 0) {
        bonusEligible = false;
      }
      
      if (bonusEligible) {
        bonusAmount = salaryRule.bonusAmount;
        totalAddition += bonusAmount;
        components['Performance Bonus'] = bonusAmount;
      }
    }

    // Calculate net payable
    const netPayable = calculatedBasic + totalAddition - totalDeduction;

    return {
      basicPay: parseFloat(calculatedBasic.toFixed(2)),
      monthlyBasic: parseFloat(monthlyBasic.toFixed(2)),
      presentDays,
      absentDays,
      lateDays,
      leaveDays: totalLeaveDays,
      totalWorkingDays: workingDaysPerMonth,
      attendancePercentage: parseFloat(attendancePercentage.toFixed(2)),
      totalAddition: parseFloat(totalAddition.toFixed(2)),
      totalDeduction: parseFloat(totalDeduction.toFixed(2)),
      netPayable: parseFloat(netPayable.toFixed(2)),
      components,
      overtime: {
        enabled: salaryRule.overtimeEnabled,
        amount: parseFloat(overtimeAmount.toFixed(2)),
        rate: salaryRule.overtimeRate
      },
      leaveDeduction: parseFloat(leaveDeduction.toFixed(2)),
      lateDeduction: parseFloat(lateDeduction.toFixed(2)),
      bonusAmount: parseFloat(bonusAmount.toFixed(2)),
      rulesApplied: {
        salaryRuleId: salaryRule._id,
        ruleName: salaryRule.title || salaryRule.ruleName,
        calculationMethod: perDaySalaryCalculation ? 'Per Day' : 'Monthly Fixed'
      },
      employeeDetails: {
        employeeId: employee.employeeId,
        name: employee.fullName || `${employee.firstName} ${employee.lastName}`,
        department: employee.department,
        designation: employee.designation
      },
      calculationPeriod: {
        start: periodStart,
        end: periodEnd,
        daysInPeriod: Math.ceil((new Date(periodEnd) - new Date(periodStart)) / (1000 * 60 * 60 * 24)) + 1
      },
      calculatedDate: new Date()
    };
  } catch (error) {
    console.error('Salary calculation error:', error);
    throw error; // Re-throw the error for better debugging
  }
};

// -------------------- Create Payroll with Auto Calculation -------------------- 
exports.createPayroll = async (req, res) => {
  try {
    const {
      employee,
      periodStart,
      periodEnd,
      status = 'Pending'
    } = req.body;

    // Validate required fields
    if (!employee || !periodStart || !periodEnd) {
      return res.status(400).json({ 
        status: "fail", 
        message: "Employee, periodStart and periodEnd are required" 
      });
    }

    // Employee details fetch WITH salaryRule population
    const employeeData = await User.findById(employee)
      .populate('salaryRule');
    
    if (!employeeData) {
      return res.status(404).json({ 
        status: "fail", 
        message: "Employee not found" 
      });
    }

    // Debug: Check if employee has salaryRule
    console.log('Employee Data:', {
      id: employeeData._id,
      name: `${employeeData.firstName} ${employeeData.lastName}`,
      hasSalaryRule: !!employeeData.salaryRule,
      salaryRule: employeeData.salaryRule
    });

    // Auto calculate salary based on attendance and leaves
    const salaryCalculation = await calculateSalary(employee, periodStart, periodEnd);
    
    if (!salaryCalculation) {
      return res.status(500).json({ 
        status: "fail", 
        message: "Failed to calculate salary" 
      });
    }

    // Build full name from firstName + lastName
    const employeeName = `${employeeData.firstName || ''} ${employeeData.lastName || ''}`.trim();

    // Check if payroll already exists for this period
    const existingPayroll = await Payroll.findOne({
      employee,
      periodStart: { $lte: periodEnd },
      periodEnd: { $gte: periodStart }
    });

    if (existingPayroll) {
      return res.status(400).json({
        status: "fail",
        message: "Payroll already exists for this period"
      });
    }

    // Create payroll with salaryRule reference
    const payroll = new Payroll({
      employee,
      name: employeeName,
      periodStart,
      periodEnd,
      basicPay: salaryCalculation.basicPay,
      presentDays: salaryCalculation.presentDays,
      absentDays: salaryCalculation.absentDays || 0,
      lateDays: salaryCalculation.lateDays || 0,
      leaveDays: salaryCalculation.leaveDays,
      totalWorkingDays: salaryCalculation.totalWorkingDays || 26,
      attendancePercentage: salaryCalculation.attendancePercentage || 0,
      totalAddition: salaryCalculation.totalAddition || 0,
      totalDeduction: salaryCalculation.totalDeduction || 0,
      netPayable: salaryCalculation.netPayable,
      status: status,
      calculationDetails: salaryCalculation.components || {},
      rulesApplied: salaryCalculation.rulesApplied || { ruleName: 'Default Rule' },
      calculatedDate: salaryCalculation.calculatedDate || new Date(),
      autoGenerated: false, // Manually created
      // Add salaryRule reference
      salaryRule: employeeData.salaryRule || null,
      salaryRuleDetails: salaryCalculation.rulesApplied || {}
    });

    await payroll.save();

    res.status(201).json({
      status: "success",
      message: "Payroll created successfully",
      data: payroll
    });

  } catch (error) {
    console.error('Create payroll error details:', error);
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
        'firstName lastName email employeeId role salary'
      )
      .sort({ periodStart: -1 });

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
    const payroll = await Payroll.findById(req.params.id)
      .populate('employee', 'firstName lastName email employeeId role salary department');
    
    if (!payroll) {
      return res.status(404).json({ status: "fail", message: "Payroll not found" });
    }
    
    res.status(200).json({ status: "success", payroll });
  } catch (error) {
    res.status(500).json({ status: "fail", message: error.message });
  }
};

// -------------------- Update Payroll Status --------------------
exports.updatePayrollStatus = async (req, res) => {
  try {
    const { status, employeeApproved } = req.body;

    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) {
      return res.status(404).json({ status: "fail", message: "Payroll not found" });
    }

    // Update status
    if (status) payroll.status = status;
    
    // Mark employee approval
    if (employeeApproved !== undefined) {
      payroll.employeeApproved = employeeApproved;
      payroll.employeeApprovedAt = employeeApproved ? new Date() : null;
    }

    await payroll.save();

    res.status(200).json({ 
      status: "success", 
      message: "Payroll updated successfully", 
      payroll 
    });
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

// -------------------- Generate Payroll for All Employees (5th of Month) --------------------
exports.generateMonthlyPayroll = async (req, res) => {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    // Set period for previous month
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0); // Last day of previous month

    // Get all active employees
    const employees = await User.find({ 
      status: 'Active',
      role: { $ne: 'admin' } // Exclude admins
    });

    const generatedPayrolls = [];
    const errors = [];

    // Generate payroll for each employee
    for (const employee of employees) {
      try {
        // Calculate salary
        const salaryCalculation = await calculateSalary(employee._id, periodStart, periodEnd);
        
        if (!salaryCalculation) {
          errors.push(`Failed to calculate salary for ${employee.employeeId}`);
          continue;
        }

        // Check if payroll already exists
        const existingPayroll = await Payroll.findOne({
          employee: employee._id,
          periodStart: periodStart,
          periodEnd: periodEnd
        });

        if (existingPayroll) {
          continue; // Skip if already exists
        }

        // Create payroll
        const employeeName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
        
        const payroll = new Payroll({
          employee: employee._id,
          name: employeeName,
          periodStart,
          periodEnd,
          basicPay: salaryCalculation.basicPay,
          presentDays: salaryCalculation.presentDays,
          totalWorkingDays: salaryCalculation.totalWorkingDays,
          attendancePercentage: salaryCalculation.attendancePercentage,
          leaveDays: salaryCalculation.leaveDays,
          totalAddition: salaryCalculation.totalAddition,
          totalDeduction: salaryCalculation.totalDeduction,
          netPayable: salaryCalculation.netPayable,
          status: 'Pending', // Employee needs to accept
          calculationDetails: salaryCalculation.components,
          rulesApplied: salaryCalculation.rulesApplied,
          calculatedDate: salaryCalculation.calculatedDate,
          autoGenerated: true,
          generatedOn: new Date()
        });

        await payroll.save();
        generatedPayrolls.push(payroll._id);

      } catch (error) {
        errors.push(`Error for ${employee.employeeId}: ${error.message}`);
      }
    }

    res.status(200).json({
      status: "success",
      message: `Generated ${generatedPayrolls.length} payrolls for ${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`,
      generatedCount: generatedPayrolls.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    res.status(500).json({ 
      status: "fail", 
      message: error.message 
    });
  }
};

// -------------------- Get Employee Payrolls --------------------
exports.getEmployeePayrolls = async (req, res) => {
  try {
    const employeeId = req.params.employeeId;
    
    const payrolls = await Payroll.find({ employee: employeeId })
      .sort({ periodStart: -1 })
      .populate('employee', 'firstName lastName employeeId');

    res.status(200).json({
      status: "success",
      payrolls
    });
  } catch (error) {
    res.status(500).json({ status: "fail", message: error.message });
  }
};

// -------------------- Accept/Reject Payroll by Employee --------------------
exports.employeeActionOnPayroll = async (req, res) => {
  try {
    const { action } = req.body; // 'accept' or 'reject'
    const { id } = req.params;
    
    const payroll = await Payroll.findById(id);
    if (!payroll) {
      return res.status(404).json({ status: "fail", message: "Payroll not found" });
    }

    // Check if payroll belongs to the requesting employee
    // (Add authentication check in production)

    if (action === 'accept') {
      payroll.employeeApproved = true;
      payroll.employeeApprovedAt = new Date();
      payroll.status = 'Paid'; // Auto approve after employee acceptance
      payroll.paymentDate = new Date();
    } else if (action === 'reject') {
      payroll.employeeApproved = false;
      payroll.employeeApprovedAt = new Date();
      payroll.status = 'Rejected';
      payroll.rejectionReason = req.body.reason || '';
    }

    await payroll.save();

    res.status(200).json({
      status: "success",
      message: `Payroll ${action}ed successfully`,
      payroll
    });
  } catch (error) {
    res.status(500).json({ status: "fail", message: error.message });
  }
};