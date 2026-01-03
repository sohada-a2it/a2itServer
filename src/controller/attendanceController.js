const mongoose = require('mongoose');
const UAParser = require('ua-parser-js');

const Attendance = require('../models/AttendanceModel');
const User = require('../models/UsersModel');
const SessionLog = require('../models/SessionLogModel');
const Holiday = require('../models/HolidayModel');

// 🔥 NEW IMPORTS
const OfficeSchedule = require('../models/OfficeScheduleModel');
const OfficeScheduleOverride = require('../models/TemporaryOfficeSchedule');

// ===================== Helper: Add activity to active session =====================
const addSessionActivity = async ({ userId, action, target = null, details = {} }) => {
  try {
    let session = await SessionLog.findOne({ userId, logoutAt: null }).sort({ loginAt: -1 });

    if (!session) {
      session = await SessionLog.create({
        userId,
        loginAt: new Date(),
        ip: details.ip || 'N/A',
        device: details.device || 'N/A',
        activities: []
      });
    }

    session.activities.push({
      action,
      target,
      details,
      timestamp: new Date()
    });

    await session.save();
    return session;
  } catch (error) {
    console.error('Add session activity failed:', error);
    return null;
  }
};

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

// ===================== Clock In =====================
exports.clockIn = async (req, res) => {
  try {
    const userId = req.user._id;

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

    // ================= 🔥 AUTO DAY STATUS DETECT =================
    let attendanceStatus = "Present";

    const dayName = today.toLocaleString("en-US", { weekday: "long" });

    // 1️⃣ Govt / Company Holiday
    const holiday = await Holiday.findOne({
      date: today,
      isActive: true
    });

    if (holiday) {
      attendanceStatus =
        holiday.type === "GOVT" ? "Govt Holiday" : "Off Day";
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

        // 3️⃣ Default Office Schedule (Friday–Saturday)
        const schedule = await OfficeSchedule.findOne({ isActive: true });
        const weeklyOffDays = schedule?.weeklyOffDays || ["Friday", "Saturday"];

        if (weeklyOffDays.includes(dayName)) {
          attendanceStatus = "Weekly Off";
        }
      }
    }
    // ============================================================

    if (!attendance) {
      attendance = new Attendance({
        employee: userId,
        date: today,
        clockIn: new Date(),
        status: attendanceStatus,
        ipAddress: req.ip,
        device: deviceInfo
      });
    } else {
      attendance.clockIn = new Date();
      attendance.status = attendanceStatus;
      attendance.ipAddress = req.ip;
      attendance.device = deviceInfo;
    }

    await attendance.save();

    await addSessionActivity({
      userId,
      action: "Clocked In",
      target: attendance._id.toString(),
      details: {
        ip: req.ip,
        device: deviceInfo,
        dayStatus: attendanceStatus
      }
    });

    res.status(200).json({
      status: "success",
      message: `Clocked in successfully (${attendanceStatus})`,
      attendance
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

    attendance.clockOut = new Date();
    attendance.totalHours =
      (attendance.clockOut - attendance.clockIn) / (1000 * 60 * 60);

    attendance.ipAddress = req.ip;
    attendance.device = deviceInfo;

    await attendance.save();

    await addSessionActivity({
      userId,
      action: "Clocked Out",
      target: attendance._id.toString(),
      details: {
        totalHours: attendance.totalHours,
        ip: req.ip,
        device: deviceInfo
      }
    });

    res.status(200).json({
      status: "success",
      message: "Clocked out successfully",
      attendance
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
    const { attendanceId, clockIn, clockOut, status } = req.body;

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
      status: attendance.status
    };

    if (clockIn) attendance.clockIn = new Date(clockIn);
    if (clockOut) attendance.clockOut = new Date(clockOut);
    if (status) attendance.status = status;

    if (attendance.clockIn && attendance.clockOut) {
      attendance.totalHours =
        (attendance.clockOut - attendance.clockIn) / (1000 * 60 * 60);
    }

    attendance.correctedByAdmin = true;
    attendance.device = parseDeviceInfo(req.headers['user-agent']);

    await attendance.save();

    await addSessionActivity({
      userId: req.user._id,
      action: "Admin Corrected Attendance",
      target: attendance._id.toString(),
      details: {
        oldData,
        newData: { clockIn, clockOut, status },
        ip: req.ip
      }
    });

    res.status(200).json({
      status: "success",
      message: "Attendance corrected",
      attendance
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Attendance Summary =====================
exports.attendanceSummary = async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({
        status: "fail",
        message: "userId is required"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found"
      });
    }

    const matchCondition = { employee: user._id };

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
          _id: "$employee",
          totalRecords: { $sum: 1 },
          totalHours: { $sum: "$totalHours" },
          daysPresent: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
          daysAbsent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } },
          daysLeave: { $sum: { $cond: [{ $eq: ["$status", "Leave"] }, 1, 0] } },
          avgHoursPerDay: { $avg: "$totalHours" },
          overtimeHours: {
            $sum: {
              $cond: [
                { $gt: ["$totalHours", 8] },
                { $subtract: ["$totalHours", 8] },
                0
              ]
            }
          }
        }
      }
    ]);

    res.status(200).json({
      status: "success",
      summary: summary[0] || {}
    });

  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};
