// controllers/sessionController.js - আপডেটেড
const mongoose = require('mongoose');
const SessionLog = require('../models/SessionLogModel');

// ==================== HELPER FUNCTIONS ====================
const validateUserId = (user) => {
  if (!user || (!user._id && !user.id)) {
    throw new Error('User ID not found');
  }
  
  const userId = user._id || user.id;
  
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid user ID format');
  }
  
  return new mongoose.Types.ObjectId(userId);
};

// ==================== USER – GET MY SESSIONS ====================
exports.getMySessions = async (req, res) => {
  try {
    const userId = validateUserId(req.user);
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // SessionLog.find ব্যবহার করুন
    const sessions = await SessionLog.find({ userId })
      .sort({ loginAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await SessionLog.countDocuments({ userId });
    
    // User তথ্য fetch করুন (একবারই)
    const User = require('../models/UsersModel');
    const user = await User.findById(userId).select('firstName lastName email role department');
    
    // formattedSessions এ clockIn, clockOut, totalHours এবং User Name যোগ করুন
    const formattedSessions = sessions.map(session => ({
      id: session._id,
      
      // ✅ User Information
      userId: session.userId,
      userName: session.userName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Unknown User',
      userEmail: session.userEmail || user?.email || 'Unknown Email',
      userRole: session.userRole || user?.role || 'employee',
      userDepartment: session.userDepartment || user?.department || 'Not assigned',
      
      // Session Information
      loginAt: session.loginAt,
      logoutAt: session.logoutAt,
      
      // ✅ Attendance data
      clockIn: session.clockIn,
      clockOut: session.clockOut,
      totalHours: session.totalHours || 0,
      
      // ✅ Formatted times
      formattedClockIn: session.clockIn ? 
        session.clockIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
        'Not clocked in',
      formattedClockOut: session.clockOut ? 
        session.clockOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
        'Not clocked out',
      formattedTotalHours: session.totalHours ? 
        `${session.totalHours.toFixed(2)} hours` : 
        '0 hours',
      
      // Session duration
      duration: session.durationMinutes || 0,
      formattedDuration: session.formattedDuration || '0m',
      
      // Device and location
      ip: session.ip,
      device: session.device,
      browser: session.browser || 'Unknown',
      os: session.os || 'Unknown',
      location: session.location || {},
      
      // Status
      status: session.sessionStatus,
      activityCount: session.activities?.length || 0,
      isActive: session.isActive || false,
      
      // ✅ Attendance status
      isClockedIn: !!session.clockIn && !session.clockOut,
      isClockedOut: !!session.clockOut,
      hasAttendance: !!session.clockIn || !!session.clockOut,
      
      // Additional info
      autoLogout: session.autoLogout || false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      
      // ✅ Formatted date and time
      formattedLoginDate: session.loginAt ? 
        session.loginAt.toLocaleDateString() : 'N/A',
      formattedLoginTime: session.loginAt ? 
        session.loginAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A',
      formattedLogoutDate: session.logoutAt ? 
        session.logoutAt.toLocaleDateString() : 'Still active',
      formattedLogoutTime: session.logoutAt ? 
        session.logoutAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Still active'
    }));

    res.status(200).json({
      success: true,
      message: `Found ${sessions.length} sessions for ${user?.firstName || 'User'}`,
      userInfo: {
        id: user?._id,
        name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
        email: user?.email,
        role: user?.role,
        department: user?.department
      },
      data: formattedSessions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ getMySessions error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your sessions',
      error: error.message
    });
  }
};

// ==================== USER – GET CURRENT SESSION ====================
exports.getMyCurrentSession = async (req, res) => {
  try {
    const userId = validateUserId(req.user);
    
    // ✅ findOne ব্যবহার করুন
    const session = await SessionLog.findOne({
      userId,
      logoutAt: null,
      sessionStatus: 'active'
    }).sort({ loginAt: -1 });

    if (!session) {
      return res.status(200).json({
        success: true,
        message: 'No active session found',
        data: null,
        isActive: false
      });
    }

    res.status(200).json({
      success: true,
      message: 'Active session found',
      data: {
        sessionId: session._id,
        loginAt: session.loginAt,
        
        // ✅ Attendance data
        clockIn: session.clockIn,
        clockOut: session.clockOut,
        totalHours: session.totalHours || 0,
        
        // ✅ Formatted
        formattedClockIn: session.clockIn ? 
          session.clockIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
          'Not clocked in',
        formattedClockOut: session.clockOut ? 
          session.clockOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
          'Not clocked out',
        formattedTotalHours: session.totalHours ? 
          `${session.totalHours.toFixed(2)} hours` : 
          '0 hours',
        
        // ✅ Status
        isClockedIn: !!session.clockIn && !session.clockOut,
        isClockedOut: !!session.clockOut,
        
        duration: session.durationMinutes || 0,
        formattedDuration: session.formattedDuration || '0m',
        ip: session.ip,
        device: session.device,
        activities: session.activities?.slice(-5) || [],
        totalActivities: session.activities?.length || 0
      },
      isActive: true
    });
  } catch (error) {
    console.error('❌ getMyCurrentSession error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current session',
      error: error.message
    });
  }
}; 

// ==================== USER – GET SESSION STATISTICS (MULTI PERIOD) ====================
exports.getSessionStatistics = async (req, res) => {
  try {
    const userId = validateUserId(req.user);
    const now = new Date();

    // Periods: last 7 days, last 30 days
    const periods = [
      { label: 'Last 7 days', days: 7 },
      { label: 'Last 30 days', days: 30 }
    ];

    const statsResult = {};

    for (const period of periods) {
      const startDate = new Date();
      startDate.setDate(now.getDate() - period.days);

      const stats = await SessionLog.aggregate([
        { $match: { userId, loginAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            totalDuration: { $sum: '$durationMinutes' },
            totalHoursWorked: { $sum: '$totalHours' },
            daysClockedIn: { $sum: { $cond: [{ $ne: ['$clockIn', null] }, 1, 0] } },
            daysClockedOut: { $sum: { $cond: [{ $ne: ['$clockOut', null] }, 1, 0] } },
            avgHoursPerDay: { $avg: '$totalHours' }
          }
        }
      ]);

      const result = stats[0] || {
        totalSessions: 0,
        totalDuration: 0,
        totalHoursWorked: 0,
        daysClockedIn: 0,
        daysClockedOut: 0,
        avgHoursPerDay: 0
      };

      statsResult[period.label] = {
        totalSessions: result.totalSessions,
        totalDurationHours: (result.totalDuration / 60).toFixed(2),
        totalHoursWorked: result.totalHoursWorked.toFixed(2),
        daysClockedIn: result.daysClockedIn,
        daysClockedOut: result.daysClockedOut,
        avgHoursPerDay: result.avgHoursPerDay.toFixed(2),
        attendanceRate: result.totalSessions > 0 ?
          ((result.daysClockedIn / result.totalSessions) * 100).toFixed(2) + '%' : '0%'
      };
    }

    res.status(200).json({
      success: true,
      message: 'User session statistics',
      data: statsResult
    });
  } catch (error) {
    console.error('❌ getSessionStatistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session statistics',
      error: error.message
    });
  }
};

// ==================== ADMIN – GET ALL SESSIONS ====================
exports.getAllSessions = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Filters
    const filter = {};
    
    if (req.query.userId) {
      filter.userId = new mongoose.Types.ObjectId(req.query.userId);
    }
    
    if (req.query.status) {
      filter.sessionStatus = req.query.status;
    }
    
    if (req.query.startDate && req.query.endDate) {
      filter.loginAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    // ✅ find ব্যবহার করুন
    const sessions = await SessionLog.find(filter)
      .sort({ loginAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await SessionLog.countDocuments(filter);

    // Format response with attendance data
    const formattedSessions = sessions.map(session => ({
      id: session._id,
      userId: session.userId,
      userName: session.userName || 'Unknown',
      userEmail: session.userEmail || 'Unknown',
      userRole: session.userRole || 'employee',
      loginAt: session.loginAt,
      logoutAt: session.logoutAt,
      
      // ✅ Attendance data
      clockIn: session.clockIn,
      clockOut: session.clockOut,
      totalHours: session.totalHours || 0,
      
      // ✅ Formatted
      formattedClockIn: session.clockIn ? 
        session.clockIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
        'Not clocked in',
      formattedClockOut: session.clockOut ? 
        session.clockOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
        'Not clocked out',
      formattedTotalHours: session.totalHours ? 
        `${session.totalHours.toFixed(2)} hours` : 
        '0 hours',
      
      duration: session.durationMinutes || 0,
      formattedDuration: session.formattedDuration || '0m',
      ip: session.ip,
      device: session.device,
      status: session.sessionStatus,
      activityCount: session.activities?.length || 0,
      isActive: session.isActive || false,
      
      // ✅ Attendance status
      isClockedIn: !!session.clockIn && !session.clockOut,
      isClockedOut: !!session.clockOut
    }));

    res.status(200).json({
      success: true,
      message: `Found ${sessions.length} sessions`,
      data: formattedSessions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ getAllSessions error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sessions',
      error: error.message
    });
  }
};

// ==================== ADMIN – GET SESSION BY ID ====================
exports.getSessionById = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const sessionId = req.params.id;
    
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session ID'
      });
    }

    // ✅ findById ব্যবহার করুন
    const session = await SessionLog.findById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: session._id,
        userId: session.userId,
        userName: session.userName,
        userEmail: session.userEmail,
        userRole: session.userRole,
        loginAt: session.loginAt,
        logoutAt: session.logoutAt,
        
        // ✅ Attendance data
        clockIn: session.clockIn,
        clockOut: session.clockOut,
        totalHours: session.totalHours || 0,
        
        // ✅ Formatted
        formattedClockIn: session.clockIn ? 
          session.clockIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
          'Not clocked in',
        formattedClockOut: session.clockOut ? 
          session.clockOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
          'Not clocked out',
        
        duration: session.durationMinutes || 0,
        formattedDuration: session.formattedDuration || '0m',
        ip: session.ip,
        device: session.device,
        status: session.sessionStatus,
        activities: session.activities || [],
        autoLogout: session.autoLogout,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        
        // ✅ Status flags
        isClockedIn: !!session.clockIn && !session.clockOut,
        isClockedOut: !!session.clockOut
      }
    });
  } catch (error) {
    console.error('❌ getSessionById error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session',
      error: error.message
    });
  }
};

// ==================== GET SESSION STATISTICS WITH ATTENDANCE ====================
exports.getSessionAttendanceStats = async (req, res) => {
  try {
    const userId = validateUserId(req.user);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stats = await SessionLog.aggregate([
      {
        $match: {
          userId: userId,
          loginAt: { $gte: thirtyDaysAgo },
          $or: [
            { clockIn: { $exists: true } },
            { clockOut: { $exists: true } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          totalDuration: { $sum: '$durationMinutes' },
          totalHoursWorked: { $sum: '$totalHours' },
          daysClockedIn: { 
            $sum: { 
              $cond: [{ $ne: ['$clockIn', null] }, 1, 0] 
            } 
          },
          daysClockedOut: { 
            $sum: { 
              $cond: [{ $ne: ['$clockOut', null] }, 1, 0] 
            } 
          },
          avgHoursPerDay: { $avg: '$totalHours' }
        }
      }
    ]);

    const result = stats[0] || {
      totalSessions: 0,
      totalDuration: 0,
      totalHoursWorked: 0,
      daysClockedIn: 0,
      daysClockedOut: 0,
      avgHoursPerDay: 0
    };

    res.status(200).json({
      success: true,
      data: {
        totalSessions: result.totalSessions,
        totalDurationHours: (result.totalDuration / 60).toFixed(2),
        totalHoursWorked: result.totalHoursWorked.toFixed(2),
        daysClockedIn: result.daysClockedIn,
        daysClockedOut: result.daysClockedOut,
        avgHoursPerDay: result.avgHoursPerDay.toFixed(2),
        attendanceRate: result.totalSessions > 0 ? 
          ((result.daysClockedIn / result.totalSessions) * 100).toFixed(2) + '%' : '0%',
        period: 'Last 30 days'
      }
    });
  } catch (error) {
    console.error('❌ getSessionAttendanceStats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session statistics'
    });
  }
};
// ==================== ADMIN – DELETE SESSION BY ID ====================
exports.deleteSessionById = async (req, res) => {
  try {
    // Check if admin or superadmin
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const sessionId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session ID'
      });
    }

    const deletedSession = await SessionLog.findByIdAndDelete(sessionId);

    if (!deletedSession) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or already deleted'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Session deleted successfully',
      data: deletedSession
    });
  } catch (error) {
    console.error('❌ deleteSessionById error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session',
      error: error.message
    });
  }
};

