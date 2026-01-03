const Leave = require('../models/LeaveModel');
const Payroll = require('../models/PayrollModel');
const Attendance = require('../models/AttendanceModel');
const Holiday = require('../models/HolidayModel');
const OfficeSchedule = require('../models/OfficeScheduleModel');
const SalaryRule = require('../models/SalaryRuleModel');
const User = require('../models/UsersModel'); 

// ---------------- Employee leave request ----------------
exports.requestLeave = async (req, res) => {
  try {
    const { leaveType, payStatus, startDate, endDate, reason } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ status: 'fail', message: 'Start and End Date are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check if start date is not before today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start < today) {
      return res.status(400).json({ 
        status: 'fail', 
        message: 'Cannot request leave for past dates' 
      });
    }

    // Calculate total days
    const diffTime = Math.abs(end - start);
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Duplicate check
    const existingLeave = await Leave.findOne({
      employee: req.user._id,
      $or: [
        {
          startDate: { $lte: end },
          endDate: { $gte: start }
        }
      ],
      status: { $in: ['Pending', 'Approved'] }
    });

    if (existingLeave) {
      return res.status(400).json({ 
        status: 'fail', 
        message: 'You already have a leave request for these dates' 
      });
    }

    // Leave create
    const leave = await Leave.create({
      employee: req.user._id,
      leaveType: leaveType || 'Sick',
      payStatus: payStatus || 'Paid',   // user choose Paid/Unpaid/HalfPaid
      startDate: start,
      endDate: end,
      totalDays,
      reason,
      createdBy: req.user._id
    });

    // Populate employee details
    const leaveWithEmployee = await Leave.findById(leave._id)
      .populate({ path: 'employee', select: 'name employeeId department email' });

    res.status(201).json({ 
      status: 'success', 
      message: 'Leave request submitted successfully',
      leave: leaveWithEmployee 
    });

  } catch (err) {
    console.error("Leave request error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Get employee's own leaves ----------------
exports.getMyLeaves = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { employee: req.user._id };

    // Apply filters if provided
    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }
    if (req.query.type && req.query.type !== 'all') {
      filter.leaveType = req.query.type;
    }
    if (req.query.startDate && req.query.endDate) {
      filter.startDate = { $gte: new Date(req.query.startDate) };
      filter.endDate = { $lte: new Date(req.query.endDate) };
    }

    // Get total count for pagination
    const total = await Leave.countDocuments(filter);

    // Get leaves with pagination
    const leaves = await Leave.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employee', select: 'name employeeId department email' });

    res.status(200).json({
      status: 'success',
      data: leaves,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error("Get my leaves error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Get all leaves (Admin only) ----------------
exports.getAllLeaves = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'fail', message: 'Only admin can view all leaves' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};

    // Apply filters if provided
    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }
    if (req.query.type && req.query.type !== 'all') {
      filter.leaveType = req.query.type;
    }
    if (req.query.employeeId) {
      const user = await User.findOne({ employeeId: req.query.employeeId });
      if (user) filter.employee = user._id;
    }
    if (req.query.department && req.query.department !== 'all') {
      const users = await User.find({ department: req.query.department });
      filter.employee = { $in: users.map(u => u._id) };
    }
    if (req.query.startDate && req.query.endDate) {
      filter.startDate = { $gte: new Date(req.query.startDate) };
      filter.endDate = { $lte: new Date(req.query.endDate) };
    }

    // Search by employee name or ID
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      const users = await User.find({
        $or: [
          { name: searchRegex },
          { employeeId: searchRegex }
        ]
      });
      filter.employee = { $in: users.map(u => u._id) };
    }

    // Get total count for pagination
    const total = await Leave.countDocuments(filter);

    // Get leaves with pagination and populate employee details
    const leaves = await Leave.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employee', select: 'name employeeId department email position' })
      .populate({ path: 'approvedBy', select: 'name' });

    res.status(200).json({
      status: 'success',
      data: leaves,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error("Get all leaves error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Admin approve leave ----------------
exports.approveLeave = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'fail', message: 'Only admin can approve leaves' });
    }

    const leave = await Leave.findById(req.params.id).populate('employee');
    if (!leave) {
      return res.status(404).json({ status: 'fail', message: 'Leave not found' });
    }

    if (leave.status !== 'Pending') {
      return res.status(400).json({ 
        status: 'fail', 
        message: `Leave is already ${leave.status.toLowerCase()}` 
      });
    }

    // Admin override payStatus
    if (req.body.payStatus) {
      leave.payStatus = req.body.payStatus; // Paid / Unpaid / HalfPaid
    }

    leave.status = 'Approved';
    leave.approvedBy = req.user._id;
    leave.approvedAt = new Date();
    await leave.save();

    const start = leave.startDate;
    const end = leave.endDate;

    // ======== Update attendance for leave days =========
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = new Date(d);
      day.setHours(0,0,0,0);

      let attendance = await Attendance.findOne({ employee: leave.employee._id, date: day });
      if (!attendance) {
        attendance = new Attendance({ 
          employee: leave.employee._id, 
          date: day,
          createdBy: req.user._id
        });
      }

      attendance.status = 'Leave';
      attendance.remarks = `Approved ${leave.leaveType} Leave`;
      attendance.updatedBy = req.user._id;
      await attendance.save();
    }

    // ======== Payroll adjustment for Unpaid / HalfPaid leave =========
    if (leave.payStatus === 'Unpaid' || leave.payStatus === 'HalfPaid') {
      const payroll = await Payroll.findOne({
        employee: leave.employee._id,
        periodStart: { $lte: start },
        periodEnd: { $gte: end },
      });

      if (payroll) {
        const dailyRate = payroll.basicPay / 30;
        let deduction = dailyRate * leave.totalDays;
        if (leave.payStatus === 'HalfPaid') deduction /= 2;

        payroll.deductions = (payroll.deductions || 0) + deduction;
        payroll.netPayable = payroll.basicPay + (payroll.overtimePay || 0) - payroll.deductions;
        payroll.updatedBy = req.user._id;
        await payroll.save();
      }
    }

    // ======== Auto attendance for Govt Holidays & Weekly Off =========
    const schedule = await OfficeSchedule.findOne({ isActive: true });
    const defaultWeeklyOff = schedule?.weeklyOffDays || ['Friday', 'Saturday'];

    const holidays = await Holiday.find({ date: { $gte: start, $lte: end }, isActive: true });
    const overrides = await OfficeScheduleOverride.find({ 
      startDate: { $lte: end },
      endDate: { $gte: start },
      isActive: true
    });

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = new Date(d);
      day.setHours(0,0,0,0);

      // Skip if leave attendance already set
      const existingAttendance = await Attendance.findOne({ employee: leave.employee._id, date: day });
      if (existingAttendance && existingAttendance.status === 'Leave') continue;

      // Check Govt Holiday
      const holiday = holidays.find(h => h.date.getTime() === day.getTime());
      if (holiday) {
        let attendance = existingAttendance || new Attendance({ 
          employee: leave.employee._id, 
          date: day,
          createdBy: req.user._id
        });
        attendance.status = holiday.type === 'GOVT' ? 'Govt Holiday' : 'Off Day';
        attendance.remarks = holiday.name;
        await attendance.save();
        continue;
      }

      // Determine effective weekly off (check override first)
      let effectiveWeeklyOff = defaultWeeklyOff;
      const overrideForDay = overrides.find(o => 
        o.startDate.getTime() <= day.getTime() && o.endDate.getTime() >= day.getTime()
      );
      if (overrideForDay) effectiveWeeklyOff = overrideForDay.weeklyOffDays;

      // Check Weekly Off
      const dayName = day.toLocaleString('en-US', { weekday: 'long' });
      if (effectiveWeeklyOff.includes(dayName)) {
        let attendance = existingAttendance || new Attendance({ 
          employee: leave.employee._id, 
          date: day,
          createdBy: req.user._id
        });
        attendance.status = 'Weekly Off';
        attendance.remarks = 'Weekly Off Day';
        await attendance.save();
      }
    }

    // Populate the updated leave
    const updatedLeave = await Leave.findById(leave._id)
      .populate({ path: 'employee', select: 'name employeeId department email' })
      .populate({ path: 'approvedBy', select: 'name' });

    res.status(200).json({ 
      status: 'success', 
      message: 'Leave approved successfully',
      leave: updatedLeave 
    });

  } catch (err) {
    console.error("Approve leave error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Admin reject leave ----------------
exports.rejectLeave = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ status: 'fail', message: 'Only admin can reject leaves' });
    }

    const leave = await Leave.findById(req.params.id).populate('employee');
    if (!leave) {
      return res.status(404).json({ status: 'fail', message: 'Leave not found' });
    }

    if (leave.status !== 'Pending') {
      return res.status(400).json({ 
        status: 'fail', 
        message: `Leave is already ${leave.status.toLowerCase()}` 
      });
    }

    leave.status = 'Rejected';
    leave.rejectionReason = req.body.reason || 'No reason provided';
    leave.rejectedBy = req.user._id;
    leave.rejectedAt = new Date();
    await leave.save();

    // Remove any attendance entries created for this leave (if any)
    await Attendance.deleteMany({
      employee: leave.employee._id,
      date: { $gte: leave.startDate, $lte: leave.endDate },
      status: 'Leave'
    });

    const updatedLeave = await Leave.findById(leave._id)
      .populate({ path: 'employee', select: 'name employeeId department email' })
      .populate({ path: 'rejectedBy', select: 'name' });

    res.status(200).json({ 
      status: 'success', 
      message: 'Leave rejected successfully',
      leave: updatedLeave 
    });

  } catch (err) {
    console.error("Reject leave error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Update leave (Employee can update pending leaves) ----------------
exports.updateLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({ status: 'fail', message: 'Leave not found' });
    }

    // Check permissions
    const isEmployeeOwner = leave.employee.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    if (!isEmployeeOwner && !isAdmin) {
      return res.status(403).json({ 
        status: 'fail', 
        message: 'You can only update your own leaves' 
      });
    }

    // Only pending leaves can be updated by employees
    if (isEmployeeOwner && leave.status !== 'Pending') {
      return res.status(400).json({ 
        status: 'fail', 
        message: 'Only pending leaves can be updated' 
      });
    }

    // Only allow certain fields to be updated
    const allowedUpdates = ['leaveType', 'payStatus', 'startDate', 'endDate', 'reason'];
    const updates = {};
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // If dates are being updated, calculate new totalDays
    if (updates.startDate || updates.endDate) {
      const startDate = updates.startDate ? new Date(updates.startDate) : leave.startDate;
      const endDate = updates.endDate ? new Date(updates.endDate) : leave.endDate;
      
      const diffTime = Math.abs(endDate - startDate);
      updates.totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }

    // Update the leave
    Object.assign(leave, updates);
    leave.updatedBy = req.user._id;
    await leave.save();

    const updatedLeave = await Leave.findById(leave._id)
      .populate({ path: 'employee', select: 'name employeeId department email' });

    res.status(200).json({ 
      status: 'success', 
      message: 'Leave updated successfully',
      leave: updatedLeave 
    });

  } catch (err) {
    console.error("Update leave error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Delete leave ----------------
exports.deleteLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({ status: 'fail', message: 'Leave not found' });
    }

    // Check permissions
    const isEmployeeOwner = leave.employee.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    if (!isEmployeeOwner && !isAdmin) {
      return res.status(403).json({ 
        status: 'fail', 
        message: 'You can only delete your own leaves' 
      });
    }

    // Only pending leaves can be deleted by employees
    if (isEmployeeOwner && leave.status !== 'Pending') {
      return res.status(400).json({ 
        status: 'fail', 
        message: 'Only pending leaves can be deleted' 
      });
    }

    // Remove attendance entries if leave was approved
    if (leave.status === 'Approved') {
      await Attendance.deleteMany({
        employee: leave.employee,
        date: { $gte: leave.startDate, $lte: leave.endDate },
        status: 'Leave'
      });
    }

    await Leave.findByIdAndDelete(req.params.id);

    res.status(200).json({ 
      status: 'success', 
      message: 'Leave deleted successfully' 
    });

  } catch (err) {
    console.error("Delete leave error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Get leave by ID ----------------
exports.getLeaveById = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate({ path: 'employee', select: 'name employeeId department email position' })
      .populate({ path: 'approvedBy', select: 'name' })
      .populate({ path: 'rejectedBy', select: 'name' });

    if (!leave) {
      return res.status(404).json({ status: 'fail', message: 'Leave not found' });
    }

    // Check permissions
    const isEmployeeOwner = leave.employee._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    if (!isEmployeeOwner && !isAdmin) {
      return res.status(403).json({ 
        status: 'fail', 
        message: 'You can only view your own leaves' 
      });
    }

    res.status(200).json({ 
      status: 'success', 
      data: leave 
    });

  } catch (err) {
    console.error("Get leave by ID error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Get leave statistics ----------------
exports.getLeaveStats = async (req, res) => {
  try {
    let filter = {};

    // For employees, only show their own stats
    if (req.user.role !== 'admin') {
      filter.employee = req.user._id;
    }

    // Apply date filter if provided
    if (req.query.year) {
      const year = parseInt(req.query.year);
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      filter.startDate = { $gte: startDate, $lt: endDate };
    }

    // Get statistics
    const totalLeaves = await Leave.countDocuments(filter);
    const pendingLeaves = await Leave.countDocuments({ ...filter, status: 'Pending' });
    const approvedLeaves = await Leave.countDocuments({ ...filter, status: 'Approved' });
    const rejectedLeaves = await Leave.countDocuments({ ...filter, status: 'Rejected' });

    // Get leave type distribution
    const leaveTypes = await Leave.aggregate([
      { $match: filter },
      { $group: { _id: '$leaveType', count: { $sum: 1 } } }
    ]);

    // Get monthly distribution for the current year
    const currentYear = new Date().getFullYear();
    const monthlyData = await Leave.aggregate([
      { 
        $match: { 
          ...filter,
          startDate: { 
            $gte: new Date(currentYear, 0, 1),
            $lt: new Date(currentYear + 1, 0, 1)
          }
        } 
      },
      {
        $group: {
          _id: { $month: '$startDate' },
          count: { $sum: 1 },
          totalDays: { $sum: '$totalDays' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        total: totalLeaves,
        pending: pendingLeaves,
        approved: approvedLeaves,
        rejected: rejectedLeaves,
        leaveTypes,
        monthlyData
      }
    });

  } catch (err) {
    console.error("Get leave stats error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Get employee's leave balance ----------------
exports.getLeaveBalance = async (req, res) => {
  try {
    let employeeId = req.user._id;
    
    // Admin can view any employee's balance
    if (req.user.role === 'admin' && req.query.employeeId) {
      const employee = await User.findOne({ employeeId: req.query.employeeId });
      if (!employee) {
        return res.status(404).json({ status: 'fail', message: 'Employee not found' });
      }
      employeeId = employee._id;
    }

    const currentYear = new Date().getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear + 1, 0, 1);

    // Get employee's approved leaves for current year
    const approvedLeaves = await Leave.find({
      employee: employeeId,
      status: 'Approved',
      startDate: { $gte: yearStart, $lt: yearEnd }
    });

    // Calculate total leave days by type
    const leaveBalance = {
      Sick: { allowed: 15, used: 0, remaining: 15 },
      Annual: { allowed: 20, used: 0, remaining: 20 },
      Casual: { allowed: 10, used: 0, remaining: 10 },
      Maternity: { allowed: 180, used: 0, remaining: 180 },
      Paternity: { allowed: 15, used: 0, remaining: 15 },
      Emergency: { allowed: 5, used: 0, remaining: 5 }
    };

    // Count used leaves
    approvedLeaves.forEach(leave => {
      if (leaveBalance[leave.leaveType]) {
        leaveBalance[leave.leaveType].used += leave.totalDays;
        leaveBalance[leave.leaveType].remaining = 
          leaveBalance[leave.leaveType].allowed - leaveBalance[leave.leaveType].used;
      }
    });

    // Get employee info
    const employee = await User.findById(employeeId).select('name employeeId department position');

    res.status(200).json({
      status: 'success',
      data: {
        employee,
        year: currentYear,
        balance: leaveBalance,
        totalUsed: approvedLeaves.reduce((sum, leave) => sum + leave.totalDays, 0)
      }
    });

  } catch (err) {
    console.error("Get leave balance error:", err);
    res.status(500).json({ status: 'fail', message: err.message });
  }
};