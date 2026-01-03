const cron = require('node-cron');
const { autoSyncBangladeshHolidays, autoMarkHolidayAttendance } = require('../services/holidayService');

// ===================== 1️⃣ Yearly Sync =====================
// Run once at Jan 1st 00:05
cron.schedule('5 0 1 1 *', async () => {
  console.log('Running yearly Bangladesh holiday sync...');
  await autoSyncBangladeshHolidays();
});

// ===================== 2️⃣ Daily Auto Attendance =====================
// Run every day at 00:01 AM
cron.schedule('1 0 * * *', async () => {
  console.log('Running daily auto holiday attendance...');
  await autoMarkHolidayAttendance();
});
// ===================== Auto Mark Attendance =====================
exports.autoMarkAttendance = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    console.log(`📅 Running auto attendance marking for: ${today.toDateString()}`);
    
    // Get all active employees
    const activeEmployees = await User.find({ 
      status: 'active',
      role: { $ne: 'admin' } // Exclude admins
    });
    
    let markedCount = 0;
    let skippedCount = 0;
    
    for (const employee of activeEmployees) {
      try {
        // Check if attendance already exists for today
        const existingAttendance = await Attendance.findOne({
          employee: employee._id,
          date: today
        });
        
        if (existingAttendance) {
          skippedCount++;
          continue;
        }
        
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
        if (employee.leaveDays && employee.leaveDays.length > 0) {
          const leaveToday = employee.leaveDays.some(leave => {
            const leaveDate = new Date(leave.date);
            leaveDate.setHours(0, 0, 0, 0);
            return leaveDate.getTime() === today.getTime() && leave.status === "approved";
          });
          
          if (leaveToday) {
            attendanceStatus = "Leave";
          }
        }
        
        // Create auto attendance record
        const attendance = new Attendance({
          employee: employee._id,
          date: today,
          clockIn: null, // No clock in for non-working days
          clockOut: null,
          status: attendanceStatus,
          ipAddress: "AUTO-SYSTEM",
          device: {
            type: "system",
            os: "auto",
            browser: "auto-marking"
          },
          location: "Auto-marked",
          autoMarked: true,
          remarks: `Auto-marked by system as ${attendanceStatus}`
        });
        
        await attendance.save();
        markedCount++;
        
        console.log(`✅ Auto-marked ${employee.email} as ${attendanceStatus}`);
        
      } catch (employeeError) {
        console.error(`Error marking attendance for ${employee.email}:`, employeeError);
      }
    }
    
    res.status(200).json({
      status: "success",
      message: `Auto attendance marking completed`,
      summary: {
        totalEmployees: activeEmployees.length,
        markedCount,
        skippedCount,
        date: today
      }
    });
    
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

// ===================== Manual Trigger Auto Mark =====================
exports.triggerAutoMark = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        status: "fail",
        message: "Only admin can trigger auto marking"
      });
    }
    
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    
    // Call auto marking function
    const result = await exports.autoMarkAttendance({ 
      body: { date: targetDate } 
    }, res);
    
    return result;
    
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};
