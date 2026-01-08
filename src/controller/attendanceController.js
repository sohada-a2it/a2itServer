const mongoose = require('mongoose');
const UAParser = require('ua-parser-js');
const cron = require('node-cron');

const Attendance = require('../models/AttendanceModel');
const User = require('../models/UsersModel');
const SessionLog = require('../models/SessionLogModel');
const Holiday = require('../models/HolidayModel');
const OfficeSchedule = require('../models/OfficeScheduleModel');
const OfficeScheduleOverride = require('../models/TemporaryOfficeSchedule');
const addSessionActivity = require('../utility/sessionLogModel');

// ===================== Parse Device Info =====================
const parseDeviceInfo = (userAgent) => {
  const parser = new UAParser(userAgent);
  const uaResult = parser.getResult();

  return {
    type: uaResult.device.type || 'desktop',
    os: uaResult.os.name || 'Unknown',
    browser: uaResult.browser.name || 'Unknown',
    userAgent
  };
};

// ===================== Helper Functions =====================

// Convert time string "HH:MM" to minutes
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Check if employee is late
const checkIfLate = (clockInTime, shiftStart, thresholdMinutes = 5) => {
  const clockInMinutes = clockInTime.getHours() * 60 + clockInTime.getMinutes();
  const shiftStartMinutes = timeToMinutes(shiftStart);
  
  const lateMinutes = clockInMinutes - shiftStartMinutes;
  return {
    isLate: lateMinutes > thresholdMinutes,
    lateMinutes: lateMinutes > thresholdMinutes ? lateMinutes - thresholdMinutes : 0
  };
};

// Get employee's shift timing (check admin override first)
const getEmployeeShiftTiming = async (employeeId, date) => {
  const today = new Date(date);
  today.setHours(0, 0, 0, 0);

  // Check if admin has adjusted shift for this date
  const attendance = await Attendance.findOne({
    employee: employeeId,
    date: today,
    adminAdjustedShift: true
  });

  if (attendance && attendance.adminShiftAdjustment) {
    return {
      start: attendance.adminShiftAdjustment.start || '09:00',
      end: attendance.adminShiftAdjustment.end || '18:00',
      isAdminAdjusted: true
    };
  }

  // Get employee's default shift timing
  const employee = await User.findById(employeeId);
  return {
    start: employee?.shiftTiming?.start || '09:00',
    end: employee?.shiftTiming?.end || '18:00',
    isAdminAdjusted: false
  };
};

// ===================== Auto Clock Out Service =====================
class AutoClockOutService {
  constructor() {
    this.isRunning = false;
    this.initializeAutoClockOut();
  }

  initializeAutoClockOut() {
    // Run at 6:10 PM daily
    cron.schedule('10 18 * * *', async () => {
      console.log('🕒 Auto clock out triggered at 6:10 PM');
      await this.executeAutoClockOut();
    });
  }

  async executeAutoClockOut() {
    if (this.isRunning) {
      console.log('⚠️ Auto clock out already running');
      return;
    }

    this.isRunning = true;
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      console.log(`🔄 Starting auto clock out at ${new Date().toLocaleString()}`);

      // Find employees who are clocked in but not clocked out
      const pendingAttendances = await Attendance.find({
        date: today,
        clockIn: { $exists: true, $ne: null },
        clockOut: { $exists: false },
        status: { $in: ['Clocked In', 'Late', 'Present'] }
      })
      .populate('employee', 'firstName lastName email employeeId department')
      .lean();

      console.log(`📊 Found ${pendingAttendances.length} employees for auto clock out`);

      const results = {
        total: pendingAttendances.length,
        success: 0,
        failed: 0,
        details: []
      };

      for (const att of pendingAttendances) {
        try {
          const clockOutTime = new Date();
          const employee = att.employee;
          
          // Get employee's shift end time
          const shiftTiming = await getEmployeeShiftTiming(employee._id, today);
          const shiftEndTime = shiftTiming.end;

          // Calculate total hours
          let totalHours = 0;
          if (att.clockIn) {
            const diffMs = clockOutTime - new Date(att.clockIn);
            totalHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
          }

          // Update attendance
          await Attendance.findByIdAndUpdate(att._id, {
            $set: {
              clockOut: clockOutTime,
              totalHours: totalHours,
              autoClockOut: true,
              autoClockOutTime: '18:10',
              status: 'Present',
              remarks: `Auto clocked out at ${clockOutTime.toLocaleTimeString()} (Shift end: ${shiftEndTime})`,
              ipAddress: 'System',
              device: { type: 'system', os: 'Auto Clock Out' }
            }
          });

          // Log activity
          await addSessionActivity({
            userId: employee._id,
            action: "Auto Clocked Out",
            target: att._id.toString(),
            targetType: "Attendance",
            details: {
              totalHours,
              clockIn: att.clockIn,
              clockOut: clockOutTime,
              shiftEndTime,
              reason: "Automatic clock out at 6:10 PM",
              autoClockOutTime: '18:10'
            }
          });

          results.success++;
          results.details.push({
            employee: `${employee.firstName} ${employee.lastName}`,
            employeeId: employee.employeeId,
            clockOutTime: clockOutTime,
            totalHours: totalHours,
            shiftEndTime,
            success: true
          });

          console.log(`✅ Auto clocked out: ${employee.firstName} ${employee.lastName} (Shift: ${shiftEndTime})`);

        } catch (error) {
          console.error(`❌ Failed to auto clock out for attendance ${att._id}:`, error);
          results.failed++;
          results.details.push({
            employee: att.employee?.firstName || 'Unknown',
            error: error.message,
            success: false
          });
        }
      }

      console.log('📋 Auto Clock Out Summary:', {
        total: results.total,
        success: results.success,
        failed: results.failed,
        time: new Date().toLocaleTimeString()
      });

      return results;

    } catch (error) {
      console.error('❌ Auto clock out job failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async triggerManualAutoClockOut() {
    console.log('🔧 Manually triggering auto clock out');
    return await this.executeAutoClockOut();
  }
}

// Initialize auto clock out service
const autoClockOutService = new AutoClockOutService();

// ===================== Get Today's Status =====================
exports.getTodayStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: userId,
      date: today
    });

    if (!attendance) {
      return res.status(200).json({
        clockedIn: false,
        clockedOut: false,
        attendance: null,
        message: "Not clocked in today"
      });
    }

    // Get shift timing
    const shiftTiming = await getEmployeeShiftTiming(userId, today);

    res.status(200).json({
      clockedIn: !!attendance.clockIn,
      clockedOut: !!attendance.clockOut,
      attendance: {
        ...attendance.toObject(),
        shiftTiming,
        isLate: attendance.isLate || false,
        lateMinutes: attendance.lateMinutes || 0
      },
      message: attendance.clockOut ? "Clocked out" : "Clocked in"
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get Attendance Records =====================
exports.getAttendanceRecords = async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate } = req.query;

    const matchCondition = { employee: userId };

    if (startDate && endDate) {
      matchCondition.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      // Default: Last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      matchCondition.date = { $gte: thirtyDaysAgo };
    }

    const records = await Attendance.find(matchCondition)
      .sort({ date: -1 })
      .populate('employee', 'firstName lastName email')
      .lean();

    // Add shift timing to each record
    const recordsWithShift = await Promise.all(
      records.map(async (record) => {
        const shiftTiming = await getEmployeeShiftTiming(userId, record.date);
        return {
          ...record,
          shiftTiming
        };
      })
    );

    res.status(200).json({
      status: "success",
      count: records.length,
      records: recordsWithShift
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get User Summary =====================
exports.getUserSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate } = req.query;

    const matchCondition = { employee: userId };

    if (startDate && endDate) {
      matchCondition.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      matchCondition.date = { $gte: thirtyDaysAgo };
    }

    const summary = await Attendance.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalHours: { $sum: "$totalHours" },
          daysPresent: { 
            $sum: { 
              $cond: [
                { $in: ["$status", ["Present", "Clocked In", "Late"]] }, 
                1, 
                0 
              ] 
            } 
          },
          daysAbsent: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Absent"] }, 
                1, 
                0 
              ] 
            } 
          },
          daysLeave: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Leave"] }, 
                1, 
                0 
              ] 
            } 
          },
          daysWeeklyOff: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Weekly Off"] }, 
                1, 
                0 
              ] 
            } 
          },
          daysGovtHoliday: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Govt Holiday"] }, 
                1, 
                0 
              ] 
            } 
          },
          daysOffDay: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Off Day"] }, 
                1, 
                0 
              ] 
            } 
          },
          lateArrivals: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Late"] },
                1,
                0
              ]
            }
          },
          autoClockOuts: {
            $sum: {
              $cond: [
                { $eq: ["$autoClockOut", true] },
                1,
                0
              ]
            }
          },
          totalLateMinutes: {
            $sum: "$lateMinutes"
          }
        }
      }
    ]);

    const result = summary[0] || {
      totalRecords: 0,
      totalHours: 0,
      daysPresent: 0,
      daysAbsent: 0,
      daysLeave: 0,
      daysWeeklyOff: 0,
      daysGovtHoliday: 0,
      daysOffDay: 0,
      lateArrivals: 0,
      autoClockOuts: 0,
      totalLateMinutes: 0
    };

    // Calculate additional metrics
    const nonWorkingDays = result.daysWeeklyOff + result.daysGovtHoliday + result.daysOffDay;
    const workingDays = result.totalRecords - nonWorkingDays;
    const attendanceRate = workingDays > 0 
      ? (result.daysPresent / workingDays) * 100 
      : 0;
    const averageHours = result.daysPresent > 0 
      ? result.totalHours / result.daysPresent 
      : 0;
    const averageLateMinutes = result.lateArrivals > 0
      ? result.totalLateMinutes / result.lateArrivals
      : 0;

    res.status(200).json({
      status: "success",
      summary: {
        ...result,
        workingDays,
        nonWorkingDays,
        attendanceRate: parseFloat(attendanceRate.toFixed(2)),
        averageHours: parseFloat(averageHours.toFixed(2)),
        averageLateMinutes: parseFloat(averageLateMinutes.toFixed(1))
      }
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Clock In =====================
exports.clockIn = async (req, res) => {
  try {
    const userId = req.user._id;
    const { timestamp, location, device } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let attendance = await Attendance.findOne({ employee: userId, date: today });
    if (attendance && attendance.clockIn) {
      return res.status(400).json({
        status: "fail",
        message: "Already clocked in today"
      });
    }

    const deviceInfo = parseDeviceInfo(req.headers['user-agent']);
    const clockInTime = timestamp ? new Date(timestamp) : new Date();

    // Get employee's shift timing
    const shiftTiming = await getEmployeeShiftTiming(userId, today);
    
    // Check if late (5 minutes after shift start)
    const employee = await User.findById(userId);
    const thresholdMinutes = employee?.lateSettings?.thresholdMinutes || 5;
    
    const lateCheck = checkIfLate(clockInTime, shiftTiming.start, thresholdMinutes);

    // ================= DAY STATUS DETECTION =================
    let attendanceStatus = "Present";
    const dayName = today.toLocaleString("en-US", { weekday: "long" });

    // 1️⃣ Govt / Company Holiday
    const holiday = await Holiday.findOne({
      date: today,
      isActive: true
    });

    if (holiday) {
      attendanceStatus = holiday.type === "GOVT" ? "Govt Holiday" : "Off Day";
    } else {
      // 2️⃣ Temporary Weekly Override
      const override = await OfficeScheduleOverride.findOne({
        isActive: true,
        startDate: { $lte: today },
        endDate: { $gte: today }
      });

      if (override && override.weeklyOffDays.includes(dayName)) {
        attendanceStatus = "Weekly Off";
      } else {
        // 3️⃣ Default Office Schedule
        const schedule = await OfficeSchedule.findOne({ isActive: true });
        const weeklyOffDays = schedule?.weeklyOffDays || ["Friday", "Saturday"];

        if (weeklyOffDays.includes(dayName)) {
          attendanceStatus = "Weekly Off";
        }
      }
    }

    // 4️⃣ Check if user is on leave
    const user = await User.findById(userId);
    if (user.leaveDays && user.leaveDays.length > 0) {
      const leaveToday = user.leaveDays.some(leave => {
        const leaveDate = new Date(leave.date);
        leaveDate.setHours(0, 0, 0, 0);
        return leaveDate.getTime() === today.getTime() && leave.status === "approved";
      });
      
      if (leaveToday) {
        attendanceStatus = "Leave";
      }
    }

    // Apply late status only if it's a working day
    if (attendanceStatus === "Present" && lateCheck.isLate) {
      attendanceStatus = "Late";
    }

    const isNonWorkingDay = ["Govt Holiday", "Weekly Off", "Leave"].includes(attendanceStatus);
    
    if (!attendance) {
      attendance = new Attendance({
        employee: userId,
        date: today,
        clockIn: isNonWorkingDay ? null : clockInTime,
        status: attendanceStatus,
        shiftTiming: {
          start: shiftTiming.start,
          end: shiftTiming.end
        },
        lateMinutes: lateCheck.lateMinutes,
        isLate: lateCheck.isLate,
        lateThreshold: thresholdMinutes,
        ipAddress: req.ip,
        device: deviceInfo,
        location: location || "Office",
        autoMarked: isNonWorkingDay
      });
    } else {
      attendance.clockIn = isNonWorkingDay ? null : clockInTime;
      attendance.status = attendanceStatus;
      attendance.shiftTiming = {
        start: shiftTiming.start,
        end: shiftTiming.end
      };
      attendance.lateMinutes = lateCheck.lateMinutes;
      attendance.isLate = lateCheck.isLate;
      attendance.lateThreshold = thresholdMinutes;
      attendance.ipAddress = req.ip;
      attendance.device = deviceInfo;
      attendance.location = location || "Office";
      attendance.autoMarked = isNonWorkingDay;
    }

    await attendance.save();

    // Activity log
    await addSessionActivity({
      userId,
      action: isNonWorkingDay ? "Auto-marked" : "Clocked In",
      target: attendance._id.toString(),
      details: {
        ip: req.ip,
        device: deviceInfo,
        dayStatus: attendanceStatus,
        location: location || "Office",
        shiftStart: shiftTiming.start,
        clockInTime: attendance.clockIn,
        isLate: lateCheck.isLate,
        lateMinutes: lateCheck.lateMinutes,
        thresholdMinutes: thresholdMinutes,
        autoMarked: isNonWorkingDay
      }
    });

    let message = isNonWorkingDay 
      ? `Auto-marked as ${attendanceStatus} (no clock in required)` 
      : `Clocked in successfully (${attendanceStatus})`;

    if (lateCheck.isLate && attendanceStatus !== "Late") {
      message += `. You are ${lateCheck.lateMinutes} minutes late (Shift: ${shiftTiming.start})`;
    }

    res.status(200).json({
      status: "success",
      message,
      attendance: {
        ...attendance.toObject(),
        lateInfo: lateCheck.isLate ? {
          isLate: true,
          lateMinutes: lateCheck.lateMinutes,
          shiftStart: shiftTiming.start,
          clockInTime: clockInTime.toLocaleTimeString()
        } : null
      },
      clockedIn: !isNonWorkingDay && !!attendance.clockIn,
      clockedOut: false,
      autoMarked: isNonWorkingDay,
      lateCheck
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Clock Out =====================
exports.clockOut = async (req, res) => {
  try {
    const userId = req.user._id;
    const { timestamp, location, device, autoClockOut = false } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: userId,
      date: today
    });

    if (!attendance || !attendance.clockIn) {
      return res.status(400).json({
        status: "fail",
        message: "Clock in first"
      });
    }

    if (attendance.clockOut) {
      return res.status(400).json({
        status: "fail",
        message: "Already clocked out today"
      });
    }

    const deviceInfo = parseDeviceInfo(req.headers['user-agent']);
    const clockOutTime = timestamp ? new Date(timestamp) : new Date();

    // ✅ CORRECTED: Remove duplicate assignment
    attendance.clockOut = clockOutTime;
    attendance.totalHours = parseFloat(
      ((clockOutTime - attendance.clockIn) / (1000 * 60 * 60)).toFixed(4)
    );
    attendance.ipAddress = req.ip;
    attendance.device = deviceInfo;
    attendance.location = location || "Office";
    
    // ✅ Add autoClockOut field if needed
    if (autoClockOut) {
      attendance.autoClockOut = true;
      attendance.autoClockOutTime = '18:10';
    }

    // Update status if it was "Clocked In" or "Late"
    if (attendance.status === "Clocked In" || attendance.status === "Late") {
      attendance.status = "Present";
    }

    await attendance.save();

    await addSessionActivity({
      userId,
      action: autoClockOut ? "Auto Clocked Out" : "Clocked Out",
      target: attendance._id.toString(),
      details: {
        totalHours: attendance.totalHours,
        ip: req.ip,
        device: deviceInfo,
        location: location || "Office",
        timestamp: clockOutTime,
        autoClockOut
      }
    });

    res.status(200).json({
      status: "success",
      message: autoClockOut ? "Auto clocked out successfully" : "Clocked out successfully",
      attendance,
      clockedIn: true,
      clockedOut: true,
      autoClockOut
    });

  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get Single Attendance =====================
exports.getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const attendance = await Attendance.findById(id)
      .populate('employee', 'firstName lastName email')
      .populate('correctedBy', 'firstName lastName email');

    if (!attendance) {
      return res.status(404).json({
        status: "fail",
        message: "Attendance record not found"
      });
    }

    // Check if user has permission to view this attendance
    const user = await User.findById(userId);
    if (attendance.employee._id.toString() !== userId.toString() && 
        user.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Not authorized to view this attendance"
      });
    }

    // Get shift timing
    const shiftTiming = await getEmployeeShiftTiming(attendance.employee._id, attendance.date);

    res.status(200).json({
      status: "success",
      attendance: {
        ...attendance.toObject(),
        shiftTiming
      }
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Admin Functions =====================

// Get All Attendance Records (Admin)
exports.getAllAttendanceRecords = async (req, res) => {
  try {
    const { startDate, endDate, employeeId, department, status, page = 1, limit = 50 } = req.query;

    const matchCondition = {};
    const skip = (page - 1) * limit;

    if (employeeId) {
      matchCondition.employee = employeeId;
    }

    if (department) {
      const employees = await User.find({ department }).select('_id');
      matchCondition.employee = { $in: employees.map(e => e._id) };
    }

    if (status) {
      matchCondition.status = status;
    }

    if (startDate && endDate) {
      matchCondition.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      matchCondition.date = { $gte: thirtyDaysAgo };
    }

    // Get total count
    const total = await Attendance.countDocuments(matchCondition);

    // Get paginated records
    const records = await Attendance.find(matchCondition)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('employee', 'firstName lastName email employeeId department designation phone')
      .populate('correctedBy', 'firstName lastName email')
      .lean();

    // Calculate summary
    const summary = await Attendance.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$totalHours" },
          presentCount: { 
            $sum: { 
              $cond: [
                { $in: ["$status", ["Present", "Clocked In", "Late"]] }, 
                1, 
                0 
              ] 
            } 
          },
          absentCount: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Absent"] }, 
                1, 
                0 
              ] 
            } 
          },
          autoClockOutCount: {
            $sum: {
              $cond: [
                { $eq: ["$autoClockOut", true] },
                1,
                0
              ]
            }
          },
          lateCount: {
            $sum: {
              $cond: [
                { $eq: ["$isLate", true] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const summaryData = summary[0] || {
      totalHours: 0,
      presentCount: 0,
      absentCount: 0,
      autoClockOutCount: 0,
      lateCount: 0
    };

    res.status(200).json({
      status: "success",
      count: records.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      summary: summaryData,
      records
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// Get Attendance Summary for All or Specific Employee (Admin)
exports.getAllAttendanceSummary = async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    const matchCondition = {};

    if (employeeId) {
      matchCondition.employee = employeeId;
    }

    if (startDate && endDate) {
      matchCondition.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      matchCondition.date = { $gte: thirtyDaysAgo };
    }

    // Get total employees count
    const totalEmployees = await User.countDocuments({ status: 'active' });

    // Get today's attendance stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const presentToday = await Attendance.countDocuments({
      date: today,
      status: { $in: ["Present", "Clocked In", "Late"] }
    });
    
    const absentToday = totalEmployees - presentToday;

    // Get aggregated summary
    const summary = await Attendance.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalHours: { $sum: "$totalHours" },
          daysPresent: { 
            $sum: { 
              $cond: [
                { $in: ["$status", ["Present", "Clocked In", "Late"]] }, 
                1, 
                0 
              ] 
            } 
          },
          daysAbsent: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Absent"] }, 
                1, 
                0 
              ] 
            } 
          },
          daysLeave: { 
            $sum: { 
              $cond: [
                { $eq: ["$status", "Leave"] }, 
                1, 
                0 
              ] 
            } 
          },
          daysHoliday: { 
            $sum: { 
              $cond: [
                { $in: ["$status", ["Govt Holiday", "Weekly Off"]] }, 
                1, 
                0 
              ] 
            } 
          },
          lateArrivals: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Late"] },
                1,
                0
              ]
            }
          },
          autoClockOuts: {
            $sum: {
              $cond: [
                { $eq: ["$autoClockOut", true] },
                1,
                0
              ]
            }
          },
          uniqueEmployees: { $addToSet: "$employee" }
        }
      },
      {
        $project: {
          totalRecords: 1,
          totalHours: 1,
          daysPresent: 1,
          daysAbsent: 1,
          daysLeave: 1,
          daysHoliday: 1,
          lateArrivals: 1,
          autoClockOuts: 1,
          totalEmployees: { $size: "$uniqueEmployees" }
        }
      }
    ]);

    const result = summary[0] || {
      totalRecords: 0,
      totalHours: 0,
      daysPresent: 0,
      daysAbsent: 0,
      daysLeave: 0,
      daysHoliday: 0,
      lateArrivals: 0,
      autoClockOuts: 0,
      totalEmployees: 0
    };

    // Calculate additional metrics
    const workingDays = result.totalRecords - result.daysHoliday;
    const attendanceRate = workingDays > 0 
      ? (result.daysPresent / workingDays) * 100 
      : 0;
    const averageHours = result.daysPresent > 0 
      ? result.totalHours / result.daysPresent 
      : 0;

    res.status(200).json({
      status: "success",
      summary: {
        ...result,
        totalEmployees,
        presentToday,
        absentToday,
        workingDays,
        attendanceRate: parseFloat(attendanceRate.toFixed(2)),
        averageHours: parseFloat(averageHours.toFixed(2))
      }
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Admin Correct Attendance =====================
exports.adminCorrectAttendance = async (req, res) => {
  try {
    const { attendanceId, clockIn, clockOut, status, shiftStart, shiftEnd } = req.body;
    const adminId = req.user._id;

    const attendance = await Attendance.findById(attendanceId);
    if (!attendance) {
      return res.status(404).json({
        status: "fail",
        message: "Attendance not found"
      });
    }

    const oldData = {
      clockIn: attendance.clockIn,
      clockOut: attendance.clockOut,
      status: attendance.status,
      shiftTiming: { ...attendance.shiftTiming }
    };

    if (clockIn) attendance.clockIn = new Date(clockIn);
    if (clockOut) attendance.clockOut = new Date(clockOut);
    if (status) attendance.status = status;
    
    // Update shift timing if provided
    if (shiftStart || shiftEnd) {
      attendance.shiftTiming.start = shiftStart || attendance.shiftTiming.start;
      attendance.shiftTiming.end = shiftEnd || attendance.shiftTiming.end;
      attendance.adminAdjustedShift = true;
      attendance.adminShiftAdjustment = {
        start: shiftStart,
        end: shiftEnd,
        adjustedBy: adminId,
        adjustmentDate: new Date(),
        reason: "Admin corrected attendance"
      };
    }

    if (attendance.clockIn && attendance.clockOut) {
      attendance.totalHours = parseFloat(
        ((attendance.clockOut - attendance.clockIn) / (1000 * 60 * 60)).toFixed(4)
      );
    }

    // Recalculate late status if clockIn and shiftStart are provided
    if (attendance.clockIn && shiftStart) {
      const employee = await User.findById(attendance.employee);
      const thresholdMinutes = employee?.lateSettings?.thresholdMinutes || 5;
      const lateCheck = checkIfLate(attendance.clockIn, shiftStart, thresholdMinutes);
      
      attendance.isLate = lateCheck.isLate;
      attendance.lateMinutes = lateCheck.lateMinutes;
    }

    attendance.correctedByAdmin = true;
    attendance.correctedBy = adminId;
    attendance.correctionDate = new Date();
    attendance.device = parseDeviceInfo(req.headers['user-agent']);

    await attendance.save();

    await addSessionActivity({
      userId: adminId,
      action: "Admin Corrected Attendance",
      target: attendance._id.toString(),
      details: {
        employeeId: attendance.employee,
        oldData,
        newData: { clockIn, clockOut, status, shiftStart, shiftEnd },
        ip: req.ip
      }
    });

    res.status(200).json({
      status: "success",
      message: "Attendance corrected successfully",
      attendance
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Admin: Update Employee Shift Timing =====================
exports.updateEmployeeShiftTiming = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { employeeId, startTime, endTime, date, reason } = req.body;

    // Validate admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Only admin can update shift timing"
      });
    }

    // Validate employee
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        status: "fail",
        message: "Employee not found"
      });
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (startTime && !timeRegex.test(startTime)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid start time format (HH:MM)"
      });
    }
    if (endTime && !timeRegex.test(endTime)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid end time format (HH:MM)"
      });
    }

    // If date is provided, adjust specific date's attendance
    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find or create attendance for that date
      let attendance = await Attendance.findOne({
        employee: employeeId,
        date: targetDate
      });

      if (!attendance) {
        // Create new attendance record if doesn't exist
        attendance = new Attendance({
          employee: employeeId,
          date: targetDate,
          status: targetDate.getTime() === today.getTime() ? 'Absent' : 'Absent',
          shiftTiming: {
            start: startTime || employee.shiftTiming?.start || '09:00',
            end: endTime || employee.shiftTiming?.end || '18:00'
          }
        });
      }

      // Update with admin adjustment
      attendance.shiftTiming.start = startTime || attendance.shiftTiming.start;
      attendance.shiftTiming.end = endTime || attendance.shiftTiming.end;
      attendance.adminAdjustedShift = true;
      attendance.adminShiftAdjustment = {
        start: startTime,
        end: endTime,
        adjustedBy: adminId,
        adjustmentDate: new Date(),
        reason: reason || "Admin adjusted shift timing"
      };

      // If already clocked in, recalculate late status
      if (attendance.clockIn && startTime) {
        const thresholdMinutes = employee.lateSettings?.thresholdMinutes || 5;
        const lateCheck = checkIfLate(attendance.clockIn, startTime, thresholdMinutes);
        
        attendance.isLate = lateCheck.isLate;
        attendance.lateMinutes = lateCheck.lateMinutes;
        if (attendance.status !== 'Late' && lateCheck.isLate) {
          attendance.status = 'Late';
        }
      }

      await attendance.save();

      res.status(200).json({
        status: "success",
        message: `Shift timing updated for ${employee.firstName} on ${targetDate.toDateString()}`,
        data: {
          employee: {
            id: employee._id,
            name: `${employee.firstName} ${employee.lastName}`,
            employeeId: employee.employeeId
          },
          shiftTiming: attendance.shiftTiming,
          adminAdjustment: attendance.adminShiftAdjustment,
          date: targetDate,
          recalculatedLate: attendance.isLate ? {
            isLate: true,
            lateMinutes: attendance.lateMinutes,
            clockInTime: attendance.clockIn?.toLocaleTimeString(),
            shiftStart: attendance.shiftTiming.start
          } : null
        }
      });

    } else {
      // Update employee's default shift timing
      if (!employee.shiftTiming) {
        employee.shiftTiming = { start: '09:00', end: '18:00' };
      }
      employee.shiftTiming.start = startTime || employee.shiftTiming.start;
      employee.shiftTiming.end = endTime || employee.shiftTiming.end;
      
      await employee.save();

      res.status(200).json({
        status: "success",
        message: `Default shift timing updated for ${employee.firstName}`,
        data: {
          employee: {
            id: employee._id,
            name: `${employee.firstName} ${employee.lastName}`,
            employeeId: employee.employeeId
          },
          shiftTiming: employee.shiftTiming,
          updatedBy: {
            adminId: admin._id,
            adminName: `${admin.firstName} ${admin.lastName}`
          },
          updatedAt: new Date()
        }
      });
    }

    // Log admin activity
    await addSessionActivity({
      userId: adminId,
      action: "Updated Employee Shift Timing",
      target: employeeId,
      targetType: "User",
      details: {
        employeeId,
        startTime,
        endTime,
        date: date || "Default",
        reason,
        adminId,
        adminName: `${admin.firstName} ${admin.lastName}`
      }
    });

  } catch (error) {
    console.error('Update shift timing error:', error);
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get Employee Shift Timing =====================
exports.getEmployeeShiftTiming = async (req, res) => {
  try {
    const { employeeId, date } = req.query;
    const userId = req.user._id;

    // Check permissions
    const user = await User.findById(userId);
    if (user.role !== 'admin' && userId.toString() !== employeeId) {
      return res.status(403).json({
        status: "fail",
        message: "Not authorized"
      });
    }

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    // Get shift timing with admin adjustments
    const shiftTiming = await getEmployeeShiftTiming(employeeId, targetDate);

    // Get employee info
    const employee = await User.findById(employeeId).select('firstName lastName employeeId department shiftTiming');

    res.status(200).json({
      status: "success",
      data: {
        employee,
        shiftTiming,
        date: targetDate,
        isToday: targetDate.toDateString() === new Date().toDateString()
      }
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Manual Trigger Auto Clock Out =====================
exports.triggerAutoClockOut = async (req, res) => {
  try {
    const adminId = req.user._id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Only admin can trigger auto clock out"
      });
    }

    const results = await autoClockOutService.triggerManualAutoClockOut();

    res.status(200).json({
      status: "success",
      message: "Auto clock out triggered manually",
      results
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get Late Statistics =====================
exports.getLateStatistics = async (req, res) => {
  try {
    const { startDate, endDate, employeeId, department } = req.query;
    const userId = req.user._id;

    // Check permissions for non-admin
    const user = await User.findById(userId);
    if (user.role !== 'admin' && employeeId && employeeId !== userId.toString()) {
      return res.status(403).json({
        status: "fail",
        message: "Not authorized"
      });
    }

    const matchCondition = { isLate: true };

    if (employeeId) {
      matchCondition.employee = employeeId;
    }

    if (department && user.role === 'admin') {
      const employees = await User.find({ department }).select('_id');
      matchCondition.employee = { $in: employees.map(e => e._id) };
    }

    if (startDate && endDate) {
      matchCondition.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      // This month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const endOfMonth = new Date();
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      matchCondition.date = {
        $gte: startOfMonth,
        $lte: endOfMonth
      };
    }

    const lateRecords = await Attendance.find(matchCondition)
      .populate('employee', 'firstName lastName employeeId department')
      .sort({ date: -1 })
      .lean();

    // Calculate statistics
    const stats = {
      totalLate: lateRecords.length,
      totalLateMinutes: lateRecords.reduce((sum, rec) => sum + (rec.lateMinutes || 0), 0),
      averageLateMinutes: lateRecords.length > 0 
        ? Math.round(lateRecords.reduce((sum, rec) => sum + (rec.lateMinutes || 0), 0) / lateRecords.length) 
        : 0,
      byEmployee: {},
      byDate: {}
    };

    // Group by employee
    lateRecords.forEach(record => {
      const empId = record.employee._id.toString();
      if (!stats.byEmployee[empId]) {
        stats.byEmployee[empId] = {
          employee: record.employee,
          lateCount: 0,
          totalLateMinutes: 0,
          averageLateMinutes: 0,
          records: []
        };
      }
      stats.byEmployee[empId].lateCount++;
      stats.byEmployee[empId].totalLateMinutes += record.lateMinutes || 0;
      stats.byEmployee[empId].records.push(record);
    });

    // Calculate averages for each employee
    Object.keys(stats.byEmployee).forEach(empId => {
      const empStats = stats.byEmployee[empId];
      empStats.averageLateMinutes = empStats.lateCount > 0 
        ? Math.round(empStats.totalLateMinutes / empStats.lateCount) 
        : 0;
    });

    // Group by date
    lateRecords.forEach(record => {
      const dateStr = record.date.toISOString().split('T')[0];
      if (!stats.byDate[dateStr]) {
        stats.byDate[dateStr] = {
          date: record.date,
          lateCount: 0,
          employees: []
        };
      }
      stats.byDate[dateStr].lateCount++;
      stats.byDate[dateStr].employees.push({
        employee: record.employee,
        lateMinutes: record.lateMinutes,
        clockInTime: record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : null,
        shiftStart: record.shiftTiming?.start
      });
    });

    res.status(200).json({
      status: "success",
      statistics: stats,
      records: lateRecords.slice(0, 50) // Limit records
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get Employee Attendance with Shift Info =====================
exports.getEmployeeAttendanceWithShift = async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;
    const userId = req.user._id;

    // Check permissions
    const user = await User.findById(userId);
    if (user.role !== 'admin' && userId.toString() !== employeeId) {
      return res.status(403).json({
        status: "fail",
        message: "Not authorized"
      });
    }

    const targetMonth = parseInt(month) || new Date().getMonth() + 1;
    const targetYear = parseInt(year) || new Date().getFullYear();

    // Calculate date range for the month
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0);
    endDate.setHours(23, 59, 59, 999);

    const attendance = await Attendance.find({
      employee: employeeId,
      date: { $gte: startDate, $lte: endDate }
    })
    .sort({ date: 1 })
    .lean();

    // Get employee info
    const employee = await User.findById(employeeId)
      .select('firstName lastName employeeId department shiftTiming lateSettings');

    // Calculate monthly summary
    const summary = {
      totalDays: attendance.length,
      presentDays: attendance.filter(a => ['Present', 'Late'].includes(a.status)).length,
      lateDays: attendance.filter(a => a.isLate).length,
      absentDays: attendance.filter(a => a.status === 'Absent').length,
      leaveDays: attendance.filter(a => a.status === 'Leave').length,
      holidayDays: attendance.filter(a => ['Govt Holiday', 'Weekly Off', 'Off Day'].includes(a.status)).length,
      totalHours: parseFloat(attendance.reduce((sum, a) => sum + (a.totalHours || 0), 0).toFixed(2)),
      totalLateMinutes: attendance.reduce((sum, a) => sum + (a.lateMinutes || 0), 0),
      averageHoursPerDay: attendance.length > 0 
        ? parseFloat((attendance.reduce((sum, a) => sum + (a.totalHours || 0), 0) / attendance.length).toFixed(2))
        : 0,
      autoClockOutDays: attendance.filter(a => a.autoClockOut).length
    };

    // Format response with shift info
    const formattedAttendance = attendance.map(record => ({
      ...record,
      date: record.date.toISOString().split('T')[0],
      day: new Date(record.date).toLocaleDateString('en-US', { weekday: 'short' }),
      clockInTime: record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : null,
      clockOutTime: record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : null,
      shiftInfo: {
        start: record.shiftTiming?.start || '09:00',
        end: record.shiftTiming?.end || '18:00',
        isAdminAdjusted: record.adminAdjustedShift || false
      },
      lateInfo: record.isLate ? {
        isLate: true,
        lateMinutes: record.lateMinutes,
        shiftStart: record.shiftTiming?.start,
        threshold: record.lateThreshold || 5
      } : null
    }));

    res.status(200).json({
      status: "success",
      employee: {
        id: employee._id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeId: employee.employeeId,
        department: employee.department,
        defaultShift: employee.shiftTiming,
        lateSettings: employee.lateSettings
      },
      period: {
        month: targetMonth,
        year: targetYear,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      },
      summary,
      attendance: formattedAttendance
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Get Attendance by Date Range =====================
exports.getAttendanceByDateRange = async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        status: "fail",
        message: "startDate and endDate are required"
      });
    }

    const records = await Attendance.find({
      employee: userId,
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    })
    .sort({ date: -1 })
    .lean();

    // Add shift timing to each record
    const recordsWithShift = await Promise.all(
      records.map(async (record) => {
        const shiftTiming = await getEmployeeShiftTiming(userId, record.date);
        return {
          ...record,
          shiftTiming
        };
      })
    );

    res.status(200).json({
      status: "success",
      count: records.length,
      records: recordsWithShift
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Export Attendance Data =====================
exports.exportAttendanceData = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    
    if (user.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Only admin can export attendance data"
      });
    }

    const { startDate, endDate, employeeId, format = 'json' } = req.query;

    const matchCondition = {};

    if (employeeId) {
      matchCondition.employee = employeeId;
    }

    if (startDate && endDate) {
      matchCondition.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      matchCondition.date = { $gte: thirtyDaysAgo };
    }

    const records = await Attendance.find(matchCondition)
      .populate('employee', 'firstName lastName email employeeId')
      .sort({ date: -1 })
      .lean();

    if (format === 'csv') {
      // Convert to CSV
      const csvData = records.map(record => ({
        Date: record.date.toISOString().split('T')[0],
        'Employee ID': record.employee?.employeeId || 'N/A',
        'Employee Name': `${record.employee?.firstName || ''} ${record.employee?.lastName || ''}`.trim(),
        'Shift Start': record.shiftTiming?.start || '09:00',
        'Shift End': record.shiftTiming?.end || '18:00',
        'Clock In': record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : 'N/A',
        'Clock Out': record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'N/A',
        'Total Hours': record.totalHours || '0.00',
        Status: record.status || 'N/A',
        'Late Minutes': record.lateMinutes || '0',
        'Auto Clock Out': record.autoClockOut ? 'Yes' : 'No',
        'IP Address': record.ipAddress || 'N/A',
        'Corrected by Admin': record.correctedByAdmin ? 'Yes' : 'No'
      }));

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=attendance_report.csv');
      
      // Simple CSV string generation
      const csvString = [
        Object.keys(csvData[0] || {}).join(','),
        ...csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
      ].join('\n');
      
      return res.send(csvString);
    }

    // Default JSON response
    res.status(200).json({
      status: "success",
      count: records.length,
      records,
      exportDate: new Date(),
      exportedBy: `${user.firstName} ${user.lastName}`
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// controllers/attendanceController.js - এ নতুন function যোগ করুন
exports.createManualAttendance = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { 
      employeeId, 
      date, 
      clockIn, 
      clockOut, 
      status,
      shiftStart = '09:00',
      shiftEnd = '18:00',
      remarks = 'Created by admin',
      isHoliday = false,
      holidayType = null 
    } = req.body;

    // Validate admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Only admin can create manual attendance"
      });
    }

    // Validate employee
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        status: "fail",
        message: "Employee not found"
      });
    }

    // Parse date
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    // Check if attendance already exists
    const existingAttendance = await Attendance.findOne({
      employee: employeeId,
      date: attendanceDate
    });

    if (existingAttendance) {
      return res.status(400).json({
        status: "fail",
        message: "Attendance already exists for this date",
        attendanceId: existingAttendance._id
      });
    }

    // Validate date (can't be future date)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (attendanceDate > today) {
      return res.status(400).json({
        status: "fail",
        message: "Cannot create attendance for future dates"
      });
    }

    // Calculate total hours if both clock in and out provided
    let totalHours = 0;
    let lateMinutes = 0;
    let isLate = false;

    if (clockIn && clockOut) {
      const clockInTime = new Date(clockIn);
      const clockOutTime = new Date(clockOut);
      
      // Calculate hours
      const diffMs = clockOutTime - clockInTime;
      totalHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(4));

      // Calculate late minutes if status is not holiday/leave
      if (!isHoliday && status === 'Present' || status === 'Late') {
        const thresholdMinutes = employee.lateSettings?.thresholdMinutes || 5;
        const lateCheck = checkIfLate(clockInTime, shiftStart, thresholdMinutes);
        lateMinutes = lateCheck.lateMinutes;
        isLate = lateCheck.isLate;
      }
    }

    // Determine final status
    let finalStatus = status;
    if (isHoliday && holidayType) {
      finalStatus = holidayType === 'GOVT' ? 'Govt Holiday' : 'Off Day';
    } else if (isLate && status === 'Present') {
      finalStatus = 'Late';
    }

    // Create new attendance
    const attendance = new Attendance({
      employee: employeeId,
      date: attendanceDate,
      clockIn: clockIn ? new Date(clockIn) : null,
      clockOut: clockOut ? new Date(clockOut) : null,
      totalHours,
      status: finalStatus,
      shiftTiming: {
        start: shiftStart,
        end: shiftEnd
      },
      lateMinutes,
      isLate,
      lateThreshold: employee.lateSettings?.thresholdMinutes || 5,
      ipAddress: req.ip || 'Admin System',
      device: {
        type: 'admin',
        os: 'Manual Entry',
        browser: 'Admin Panel'
      },
      location: "Office",
      correctedByAdmin: true,
      correctedBy: adminId,
      correctionDate: new Date(),
      remarks: remarks,
      adminAdjustedShift: true,
      adminShiftAdjustment: {
        start: shiftStart,
        end: shiftEnd,
        adjustedBy: adminId,
        adjustmentDate: new Date(),
        reason: 'Manual attendance created by admin'
      }
    });

    await attendance.save();

    // Log activity
    await addSessionActivity({
      userId: adminId,
      action: "Manual Attendance Created",
      target: attendance._id.toString(),
      targetType: "Attendance",
      details: {
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        date: attendanceDate,
        clockIn,
        clockOut,
        status: finalStatus,
        totalHours,
        isLate,
        lateMinutes,
        adminId,
        adminName: `${admin.firstName} ${admin.lastName}`
      }
    });

    res.status(201).json({
      status: "success",
      message: "Manual attendance created successfully",
      attendance,
      details: {
        employee: {
          id: employee._id,
          name: `${employee.firstName} ${employee.lastName}`,
          employeeId: employee.employeeId
        },
        date: attendanceDate.toISOString().split('T')[0],
        totalHours,
        status: finalStatus,
        isLate,
        lateMinutes
      }
    });

  } catch (error) {
    console.error('Create manual attendance error:', error);
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

exports.createBulkAttendance = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { 
      employeeId, 
      month, 
      year,
      defaultShiftStart = '09:00',
      defaultShiftEnd = '18:00',
      holidays = [], // Array of holiday dates
      leaveDates = [], // Array of leave dates
      workingDays = [], // Specific working days data
      markAllAsPresent = false, // Option to mark all as present
      skipWeekends = true // Skip Saturday, Sunday
    } = req.body;

    console.log('Bulk attendance request:', { employeeId, month, year });

    // Validate admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Only admin can create bulk attendance"
      });
    }

    // Validate employee
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        status: "fail",
        message: "Employee not found"
      });
    }

    const targetMonth = parseInt(month) || new Date().getMonth() + 1;
    const targetYear = parseInt(year) || new Date().getFullYear();

    // Validate month/year (can't be future)
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    if (targetYear > currentYear || (targetYear === currentYear && targetMonth > currentMonth)) {
      return res.status(400).json({
        status: "fail",
        message: "Cannot create attendance for future months"
      });
    }

    // Calculate date range for the month
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0);
    endDate.setHours(23, 59, 59, 999);

    console.log(`Processing month: ${targetMonth}/${targetYear}, Days: ${endDate.getDate()}`);

    // Get existing attendances for this month
    const existingAttendances = await Attendance.find({
      employee: employeeId,
      date: { $gte: startDate, $lte: endDate }
    });

    const existingDatesMap = new Map();
    existingAttendances.forEach(att => {
      const dateStr = att.date.toISOString().split('T')[0];
      existingDatesMap.set(dateStr, att);
    });

    // Get office schedule for weekly off days
    const officeSchedule = await OfficeSchedule.findOne({ isActive: true });
    const weeklyOffDays = officeSchedule?.weeklyOffDays || ["Friday", "Saturday"];

    const results = {
      totalDays: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      details: [],
      summary: {
        present: 0,
        absent: 0,
        late: 0,
        leave: 0,
        holiday: 0,
        weeklyOff: 0
      }
    };

    // Process each day of the month
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      results.totalDays++;
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayName = currentDate.toLocaleString('en-US', { weekday: 'long' });
      const dayOfWeek = currentDate.getDay(); // 0=Sunday, 6=Saturday

      try {
        // Check if it's a weekend and should be skipped
        if (skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
          results.skipped++;
          results.details.push({
            date: dateStr,
            day: dayName,
            status: 'skipped',
            reason: 'Weekend (skipped)'
          });
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }

        // Check if date exists in existing attendance
        const existingAttendance = existingDatesMap.get(dateStr);

        // Determine status and data
        let status = 'Absent';
        let remarks = 'Created via bulk attendance';
        let clockIn = null;
        let clockOut = null;
        let totalHours = 0;
        let isLate = false;
        let lateMinutes = 0;
        let shiftStart = defaultShiftStart;
        let shiftEnd = defaultShiftEnd;

        // Check if it's a holiday
        const holiday = holidays.find(h => {
          const holidayDate = new Date(h.date);
          holidayDate.setHours(0, 0, 0, 0);
          return holidayDate.getTime() === currentDate.getTime();
        });

        // Check if it's a leave date
        const leaveDay = leaveDates.find(l => {
          const leaveDate = new Date(l.date);
          leaveDate.setHours(0, 0, 0, 0);
          return leaveDate.getTime() === currentDate.getTime();
        });

        // Check if specific working day data exists
        const workingDayData = workingDays.find(w => {
          const workDate = new Date(w.date);
          workDate.setHours(0, 0, 0, 0);
          return workDate.getTime() === currentDate.getTime();
        });

        // Check if it's a weekly off day
        const isWeeklyOff = weeklyOffDays.includes(dayName);

        // Determine final status
        if (holiday) {
          status = holiday.type === 'GOVT' ? 'Govt Holiday' : 'Off Day';
          remarks = holiday.reason || 'Holiday';
          results.summary.holiday++;
        } else if (isWeeklyOff) {
          status = 'Weekly Off';
          remarks = 'Weekly off day';
          results.summary.weeklyOff++;
        } else if (leaveDay) {
          status = 'Leave';
          remarks = leaveDay.type || 'Leave';
          results.summary.leave++;
        } else if (workingDayData) {
          // Use specific data for this day
          status = workingDayData.status || 'Present';
          clockIn = workingDayData.clockIn || null;
          clockOut = workingDayData.clockOut || null;
          shiftStart = workingDayData.shiftStart || defaultShiftStart;
          shiftEnd = workingDayData.shiftEnd || defaultShiftEnd;
          remarks = workingDayData.remarks || 'Manual entry by admin';

          if (clockIn && clockOut) {
            const clockInTime = new Date(clockIn);
            const clockOutTime = new Date(clockOut);
            const diffMs = clockOutTime - clockInTime;
            totalHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(4));

            // Check if late
            const thresholdMinutes = employee.lateSettings?.thresholdMinutes || 5;
            const lateCheck = checkIfLate(clockInTime, shiftStart, thresholdMinutes);
            isLate = lateCheck.isLate;
            lateMinutes = lateCheck.lateMinutes;
            
            if (isLate && status === 'Present') {
              status = 'Late';
            }
          }

          // Update summary
          if (status === 'Present' || status === 'Late') {
            results.summary.present++;
            if (status === 'Late') results.summary.late++;
          }
        } else if (markAllAsPresent && !isWeeklyOff && !holiday && !leaveDay) {
          // Mark as present if option is enabled
          status = 'Present';
          // Generate random clock in/out times (for demo)
          const randomClockIn = new Date(currentDate);
          randomClockIn.setHours(9, Math.floor(Math.random() * 30), 0, 0); // 9:00 - 9:30
          
          const randomClockOut = new Date(currentDate);
          randomClockOut.setHours(17, Math.floor(Math.random() * 60), 0, 0); // 17:00 - 18:00
          
          clockIn = randomClockIn.toISOString();
          clockOut = randomClockOut.toISOString();
          
          const diffMs = randomClockOut - randomClockIn;
          totalHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(4));
          
          remarks = 'Auto-generated as present';
          results.summary.present++;
        } else {
          // Default: Mark as absent for working days
          status = 'Absent';
          remarks = 'No attendance record';
          results.summary.absent++;
        }

        if (existingAttendance) {
          // Update existing attendance
          existingAttendance.clockIn = clockIn ? new Date(clockIn) : null;
          existingAttendance.clockOut = clockOut ? new Date(clockOut) : null;
          existingAttendance.totalHours = totalHours;
          existingAttendance.status = status;
          existingAttendance.shiftTiming = {
            start: shiftStart,
            end: shiftEnd
          };
          existingAttendance.lateMinutes = lateMinutes;
          existingAttendance.isLate = isLate;
          existingAttendance.remarks = remarks;
          existingAttendance.correctedByAdmin = true;
          existingAttendance.correctedBy = adminId;
          existingAttendance.correctionDate = new Date();

          await existingAttendance.save();
          results.updated++;
          results.details.push({
            date: dateStr,
            day: dayName,
            status: 'updated',
            attendanceId: existingAttendance._id,
            details: { status, totalHours, isLate }
          });
        } else {
          // Create new attendance
          const attendance = new Attendance({
            employee: employeeId,
            date: new Date(currentDate),
            clockIn: clockIn ? new Date(clockIn) : null,
            clockOut: clockOut ? new Date(clockOut) : null,
            totalHours,
            status,
            shiftTiming: {
              start: shiftStart,
              end: shiftEnd
            },
            lateMinutes,
            isLate,
            lateThreshold: employee.lateSettings?.thresholdMinutes || 5,
            ipAddress: req.ip || 'Admin System',
            device: {
              type: 'admin',
              os: 'Bulk Entry',
              browser: 'Admin Panel'
            },
            location: "Office",
            correctedByAdmin: true,
            correctedBy: adminId,
            correctionDate: new Date(),
            remarks,
            adminAdjustedShift: true,
            adminShiftAdjustment: {
              start: shiftStart,
              end: shiftEnd,
              adjustedBy: adminId,
              adjustmentDate: new Date(),
              reason: 'Bulk attendance creation'
            }
          });

          await attendance.save();
          results.created++;
          results.details.push({
            date: dateStr,
            day: dayName,
            status: 'created',
            attendanceId: attendance._id,
            details: { status, totalHours, isLate }
          });
        }

      } catch (error) {
        console.error(`Failed to process date ${dateStr}:`, error);
        results.failed++;
        results.details.push({
          date: dateStr,
          day: dayName,
          status: 'failed',
          error: error.message
        });
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Log bulk activity
    await addSessionActivity({
      userId: adminId,
      action: "Bulk Attendance Created",
      target: employeeId,
      targetType: "User",
      details: {
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        month: targetMonth,
        year: targetYear,
        results,
        adminId,
        adminName: `${admin.firstName} ${admin.lastName}`
      }
    });

    res.status(200).json({
      status: "success",
      message: `Bulk attendance processed for ${targetMonth}/${targetYear}`,
      results,
      summary: {
        employee: {
          id: employee._id,
          name: `${employee.firstName} ${employee.lastName}`,
          employeeId: employee.employeeId
        },
        period: {
          month: targetMonth,
          year: targetYear,
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          totalDays: results.totalDays
        },
        statistics: results.summary
      }
    });

  } catch (error) {
    console.error('Bulk attendance error:', error);
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};