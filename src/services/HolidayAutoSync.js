const axios = require("axios");
const Holiday = require("../models/HolidayModel");
const Attendance = require("../models/AttendanceModel");
const User = require("../models/UsersModel");

// ===================== 1️⃣ Yearly Auto Sync Holidays =====================
const autoSyncBangladeshHolidays = async () => {
  const year = new Date().getFullYear();

  // check if already synced
  const alreadySynced = await Holiday.findOne({
    year,
    source: "AUTO",
  });
  if (alreadySynced) return;

  try {
    // fetch BD holidays from API
const { data } = await axios.get(
  `https://calendarific.com/api/v2/holidays?api_key=${process.env.CALENDARIFIC_API_KEY}&country=BD&year=${year}`
);

const holidaysList = data.response.holidays; // <-- এটা array

for (const h of holidaysList) {
  await Holiday.create({
    title: h.name,
    date: new Date(h.date.iso), // <-- note .iso
    type: "GOVT",
    source: "AUTO",
    year,
    isActive: true,
  });
}

console.log(`✅ Holidays synced for year ${year}`);

  } catch (error) {
    console.error("Holiday sync failed:", error.message);
  }
};

// ===================== 2️⃣ Daily Auto Mark Holiday Attendance =====================
const autoMarkHolidayAttendance = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // check if today is holiday
  const holiday = await Holiday.findOne({
    date: today,
    isActive: true,
  });
  if (!holiday) return; // not a holiday

  // fetch all active employees
  const employees = await User.find({ role: 'employee', status: 'Active' });

  for (const emp of employees) {
    // check if attendance already exists
    const attendance = await Attendance.findOne({ employee: emp._id, date: today });
    if (!attendance) {
      await Attendance.create({
        employee: emp._id,
        date: today,
        status: holiday.type === "GOVT" ? "Govt Holiday" : "Off Day",
        clockIn: null,
        clockOut: null,
        totalHours: 0,
        ipAddress: 'AUTO',
        device: { type: 'system', os: 'AUTO', browser: 'AUTO', userAgent: 'AUTO' },
        autoMarked: true
      });
    }
  }

  console.log(`✅ Auto-marked holiday attendance for ${today.toDateString()}`);
};

module.exports = {
  autoSyncBangladeshHolidays,
  autoMarkHolidayAttendance
};
